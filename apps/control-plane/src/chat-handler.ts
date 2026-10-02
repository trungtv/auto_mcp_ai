import type { Registry } from "@auto-mcp/registry";
import type { Vault } from "@auto-mcp/vault";
import {
  cancelLoginSession,
  closeBrowserReplay,
  closeBrowserSession,
  ensureBrowserSession,
} from "@auto-mcp/browser-auth";
import {
  buildBrowserCustomTools,
  isCursorSdkConfigured,
  makeChatMessage,
  streamSiteChat,
  type ChatStreamEvent,
  type SiteInventorySnapshot,
} from "@auto-mcp/cursor-discover";
import {
  listCapabilitiesForSite,
  listSeedCapabilities,
  resolveAdapter,
} from "@auto-mcp/site-adapters";
import { ChatInputSchema, type ChatActivityStep, type McpSite } from "@auto-mcp/shared";
import { resolve } from "node:path";
import { ROOT_DIR, getEnv } from "./env.js";
import {
  persistCapture,
  publishCallbacksForSite,
  siteOpsFrom,
} from "./explore-publish-callbacks.js";
import { packAuthorCallbacksForSite } from "./pack-author-callbacks.js";

function siteInventory(site: McpSite): SiteInventorySnapshot {
  const adapter = resolveAdapter(site);
  const primitives = site.tools.filter((t) => t.approved !== false);
  const seeds = listSeedCapabilities({ site, primitives });
  const effective = listCapabilitiesForSite({ site, primitives });
  return {
    adapterId: adapter.id,
    primitives: site.tools.map((t) => ({
      name: t.name,
      title: t.title,
      method: t.method,
      url: t.url,
      approved: t.approved,
      rpcMethod: t.captureContext?.rpcMethod,
    })),
    capabilities: effective.map((c) => ({
      name: c.name,
      title: c.title,
      description: c.description,
      bind: c.bind,
    })),
    storedCapabilityNames: (site.capabilities ?? []).map((c) => c.name),
    seedCapabilityNames: seeds.map((c) => c.name),
  };
}

function upsertActivity(
  steps: ChatActivityStep[],
  toolIndex: Map<string, number>,
  ev: ChatStreamEvent,
): void {
  const at = new Date().toISOString();
  if (ev.type === "status") {
    steps.push({ kind: "status", at, text: ev.message });
  } else if (ev.type === "thinking") {
    const last = steps[steps.length - 1];
    if (last?.kind === "thinking") {
      last.text = ev.text;
    } else {
      steps.push({ kind: "thinking", at, text: ev.text });
    }
  } else if (ev.type === "tool") {
    const existing = toolIndex.get(ev.callId);
    if (existing !== undefined) {
      const step = steps[existing]!;
      step.toolStatus = ev.status;
      step.argsSummary = ev.argsSummary ?? step.argsSummary;
      step.resultSummary = ev.resultSummary ?? step.resultSummary;
      step.toolName = ev.name;
    } else {
      toolIndex.set(ev.callId, steps.length);
      steps.push({
        kind: "tool",
        at,
        callId: ev.callId,
        toolName: ev.name,
        toolStatus: ev.status,
        argsSummary: ev.argsSummary,
        resultSummary: ev.resultSummary,
      });
    }
  }
}

export async function handleChatSse(opts: {
  siteId: string;
  body: unknown;
  registry: Registry;
  vault: Vault;
  cursorApiKey: string;
}): Promise<Response> {
  const site = opts.registry.get(opts.siteId);
  if (!site) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!opts.vault.has(site.id)) {
    return Response.json(
      { error: "Authenticate first (Đăng nhập) before chat explore" },
      { status: 400 },
    );
  }

  const { message } = ChatInputSchema.parse(opts.body);
  opts.registry.appendChatMessage(site.id, makeChatMessage("user", message));

  // Avoid two persistent contexts on the same profile
  await cancelLoginSession(site.id);
  await closeBrowserReplay(site.id);

  let focus = site.exploreFocus ?? message;
  const { round } = opts.registry.startExploreRound(site.id, focus);
  const hasKey = isCursorSdkConfigured(opts.cursorApiKey);

  const customTools = buildBrowserCustomTools({
    baseUrl: site.baseUrl,
    getSession: async () => {
      await cancelLoginSession(site.id);
      await closeBrowserReplay(site.id);
      return ensureBrowserSession({
        siteId: site.id,
        baseUrl: site.baseUrl,
        profileDir: site.profileDir,
        auth: opts.vault.get(site.id),
      });
    },
    onCandidates: async (candidates, nextFocus, ui) => {
      if (nextFocus) focus = nextFocus;
      const snap = await (
        await ensureBrowserSession({
          siteId: site.id,
          baseUrl: site.baseUrl,
          profileDir: site.profileDir,
          auth: opts.vault.get(site.id),
        })
      ).authSnapshot();
      opts.vault.set(site.id, snap);
      const { site: updated, added } = opts.registry.mergeSiteCandidates(
        site.id,
        candidates,
        { exploreRound: round.id, focus },
      );
      persistCapture(
        { registry: opts.registry },
        site.id,
        candidates,
        ui,
        round.id,
      );
      return { added, total: updated.candidates.length };
    },
    listCandidates: () => opts.registry.get(site.id)?.candidates ?? [],
    listSiteTools: () => {
      const current = opts.registry.get(site.id);
      return (current?.tools ?? []).map((t) => ({
        name: t.name,
        title: t.title,
        method: t.method,
        url: t.url,
        approved: t.approved,
        rpcMethod: t.captureContext?.rpcMethod,
      }));
    },
    getSiteInventory: () => {
      const current = opts.registry.get(site.id) ?? site;
      return siteInventory(current);
    },
    setFocus: (f) => {
      focus = f;
      opts.registry.update(site.id, { exploreFocus: f });
    },
    getFocus: () => opts.registry.get(site.id)?.exploreFocus ?? focus,
    ...publishCallbacksForSite(
      siteOpsFrom({
        registry: opts.registry,
        vault: opts.vault,
        dataDir: getEnv().dataDir,
        masterKey: getEnv().masterKey,
        runtimeEntry: resolve(ROOT_DIR, "packages/mcp-runtime/dist/cli.js"),
      }),
      site.id,
    ),
    ...packAuthorCallbacksForSite({
      repoRoot: ROOT_DIR,
      getSite: () => opts.registry.get(site.id) ?? site,
    }),
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      // Flush immediately so UI shows activity (and Vite proxy doesn't look hung)
      const activity: ChatActivityStep[] = [];
      const toolIndex = new Map<string, number>();
      const initialStatus = {
        type: "status" as const,
        message: hasKey
          ? "Đã nhận message — bắt đầu chat explore…"
          : "Chưa có CURSOR_API_KEY trong .env — đang thử auth local của Cursor…",
      };
      upsertActivity(activity, toolIndex, initialStatus);
      send(initialStatus);
      try {
        let agentId = site.chatAgentId;
        let assistantText = "";
        const live = opts.registry.get(site.id) ?? site;
        for await (const ev of streamSiteChat(
          {
            apiKey: hasKey ? opts.cursorApiKey : undefined,
            cwd: ROOT_DIR,
            siteName: live.name,
            baseUrl: live.baseUrl,
            explorePath: live.explorePath,
            agentId,
            customTools,
            inventory: siteInventory(live),
          },
          message,
        )) {
          if (ev.type === "agent") {
            agentId = ev.agentId;
            opts.registry.update(site.id, { chatAgentId: agentId });
          }
          if (ev.type === "token") assistantText += ev.text;
          if (ev.type === "assistant_done" && ev.text) assistantText = ev.text;
          upsertActivity(activity, toolIndex, ev);
          send(ev);
          if (ev.type === "tool" && ev.status === "completed") {
            const fresh = opts.registry.get(site.id);
            send({
              type: "candidates",
              total: fresh?.candidates.length ?? 0,
            });
          }
        }
        if (assistantText || activity.length > 0) {
          opts.registry.appendChatMessage(
            site.id,
            makeChatMessage("assistant", assistantText || "(không có text)", {
              activity: activity.length > 0 ? activity : undefined,
            }),
          );
        }
        const fresh = opts.registry.get(site.id);
        send({
          type: "done",
          site: fresh,
          candidateCount: fresh?.candidates.length ?? 0,
        });
      } catch (err) {
        console.error("[chat]", err);
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        opts.registry.update(site.id, {
          status: opts.vault.has(site.id) ? "ready" : "needs_auth",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function cleanupSiteSessions(siteId: string): Promise<void> {
  await cancelLoginSession(siteId);
  await closeBrowserReplay(siteId);
  await closeBrowserSession(siteId);
}
