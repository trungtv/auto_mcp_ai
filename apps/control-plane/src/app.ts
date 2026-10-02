import { Hono } from "hono";
import { cors } from "hono/cors";
import { Registry } from "@auto-mcp/registry";
import { Vault } from "@auto-mcp/vault";
import {
  ApproveToolsInputSchema,
  CreateSiteInputSchema,
  ToolDefSchema,
} from "@auto-mcp/shared";
import {
  startLoginSession,
  completeLoginSession,
  cancelLoginSession,
  hasLoginSession,
  exploreAndCapture,
  closeBrowserSession,
  closeBrowserReplay,
} from "@auto-mcp/browser-auth";
import { normalizeCandidates } from "@auto-mcp/explorer";
import {
  approveCandidatesOp,
  persistCapture,
  type SiteOpsContext,
} from "@auto-mcp/mcp-control";
import { mergeTools, upgradeTools } from "@auto-mcp/mcp-generator";
import {
  AuthExpiredError,
  assertToolUrlAllowed,
  buildMcpEntry,
  defaultCursorMcpPath,
  formatReplayResult,
  mergeCursorMcpConfig,
  readCursorMcpConfig,
  removeCursorMcpConfig,
  createSiteReplay,
} from "@auto-mcp/mcp-runtime";
import type { McpSite, ToolDef } from "@auto-mcp/shared";
import type { ReplayFn } from "@auto-mcp/site-adapters";
import {
  listCapabilitiesForSite,
  listSeedCapabilities,
  getCapability,
  resolveAdapter,
} from "@auto-mcp/site-adapters";
import {
  isCursorSdkConfigured,
  proposeToolsWithCursorSdk,
} from "@auto-mcp/cursor-discover";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { getEnv, ROOT_DIR } from "./env.js";
import { cleanupSiteSessions, handleChatSse } from "./chat-handler.js";

function assertToolsOrigin(site: McpSite, tools: ToolDef[]): void {
  for (const tool of tools) {
    assertToolUrlAllowed(tool.url, site.baseUrl);
  }
}

export function createApp() {
  const env = getEnv();
  mkdirSync(env.dataDir, { recursive: true });
  const registry = new Registry(env.dataDir);
  const vault = new Vault(env.dataDir, env.masterKey);

  function siteOps(): SiteOpsContext {
    return {
      registry,
      vault,
      dataDir: env.dataDir,
      masterKey: env.masterKey,
      runtimeEntry: resolve(ROOT_DIR, "packages/mcp-runtime/dist/cli.js"),
    };
  }

  function siteReplay(site: McpSite): ReplayFn {
    return createSiteReplay({
      site,
      onAuth: (snap) => vault.set(site.id, snap),
    });
  }

  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "http://127.0.0.1:5173";
        try {
          const u = new URL(origin);
          if (
            (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
            u.protocol === "http:"
          ) {
            return origin;
          }
        } catch {
          /* ignore */
        }
        return null;
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    if (env.allowInsecureDev && !env.controlToken) return next();
    const header = c.req.header("Authorization") ?? "";
    const expected = env.controlToken ? `Bearer ${env.controlToken}` : "";
    if (!expected || header !== expected) {
      return c.json({ error: "Unauthorized — set Authorization: Bearer <AUTO_MCP_CONTROL_TOKEN>" }, 401);
    }
    return next();
  });

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      cursorSdk: isCursorSdkConfigured(env.cursorApiKey),
      authRequired: Boolean(env.controlToken) || !env.allowInsecureDev,
    }),
  );

  app.get("/api/sites", (c) => c.json({ sites: registry.list() }));

  app.get("/api/sites/:id", (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    return c.json({
      site,
      hasAuth: vault.has(site.id),
    });
  });

  app.get("/api/sites/:id/capabilities", (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    const adapter = resolveAdapter(site);
    const primitives = upgradeTools(site.tools.filter((t) => t.approved));
    const seeds = listSeedCapabilities({ site, primitives });
    const caps = listCapabilitiesForSite({ site, primitives });
    return c.json({
      adapterId: adapter.id,
      supportsArgMutation: adapter.supportsArgMutation ?? {},
      stored: site.capabilities ?? [],
      seeds: seeds.map((cap) => ({
        name: cap.name,
        title: cap.title,
        description: cap.description,
        supportsMutation: Boolean(cap.supportsMutation),
        bind: cap.bind,
        inputSchema: cap.inputSchema,
      })),
      capabilities: caps.map((cap) => ({
        name: cap.name,
        title: cap.title,
        description: cap.description,
        supportsMutation: Boolean(cap.supportsMutation),
        bind: cap.bind,
        inputSchema: cap.inputSchema,
        annotations: cap.annotations,
      })),
      primitiveCount: primitives.length,
    });
  });

  app.post("/api/sites/:id/capabilities/:name/try", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    const name = decodeURIComponent(c.req.param("name"));
    if (!vault.has(site.id)) {
      return c.json({ error: "No auth in vault — login first" }, 400);
    }
    const auth = vault.get(site.id);
    if (!auth) {
      return c.json({ error: "No auth in vault — login first" }, 400);
    }
    const body = z
      .object({ args: z.record(z.unknown()).optional() })
      .parse(await c.req.json().catch(() => ({})));
    const primitives = upgradeTools(site.tools.filter((t) => t.approved));
    const cap = getCapability({ site, primitives }, name);
    if (!cap) {
      return c.json({ error: `Unknown capability: ${name}` }, 404);
    }
    try {
      const result = await cap.execute(
        { site, auth, primitives, replay: siteReplay(site) },
        body.args ?? {},
      );
      return c.json({
        ...(result.structuredContent ?? {}),
        isError: result.isError,
        text: result.content[0]?.text,
      });
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        return c.json({ error: err.message }, 401);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/sites", async (c) => {
    const body = CreateSiteInputSchema.parse(await c.req.json());
    const placeholder = resolve(env.dataDir, "profiles", "_pending");
    mkdirSync(placeholder, { recursive: true });
    const site = registry.create(body, placeholder);
    const profileDir = registry.profileDirFor(env.dataDir, site.id, site.baseUrl);
    mkdirSync(profileDir, { recursive: true });
    const updated = registry.update(site.id, { profileDir });
    return c.json({ site: updated }, 201);
  });

  app.delete("/api/sites/:id", async (c) => {
    const id = c.req.param("id");
    const site = registry.get(id);
    if (!site) return c.json({ error: "Not found" }, 404);
    await cleanupSiteSessions(id);
    try {
      removeCursorMcpConfig(defaultCursorMcpPath(), site.cursorMcpKey);
    } catch {
      /* ignore */
    }
    vault.delete(id);
    registry.delete(id);
    return c.json({ ok: true });
  });

  app.post("/api/sites/:id/login", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);

    try {
      await closeBrowserReplay(site.id);
      await closeBrowserSession(site.id);
      await startLoginSession({
        siteId: site.id,
        baseUrl: site.baseUrl,
        profileDir: site.profileDir,
      });
      return c.json({
        ok: true,
        awaitingConfirm: true,
        hasLoginSession: true,
        message:
          "Browser đã mở. Đăng nhập xong rồi bấm «Đã đăng nhập xong» trên dashboard.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/sites/:id/login/confirm", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);

    try {
      const snapshot = await completeLoginSession(site.id);
      vault.set(site.id, snapshot);
      const updated = registry.update(site.id, {
        status: "ready",
        lastAuthAt: snapshot.capturedAt,
      });
      return c.json({ site: updated, hasAuth: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/sites/:id/login/cancel", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    await cancelLoginSession(site.id);
    return c.json({ ok: true, hasLoginSession: false });
  });

  app.get("/api/sites/:id/login/status", (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    return c.json({ awaitingConfirm: hasLoginSession(site.id) });
  });

  /** Passive settle capture — merges into accumulated candidates. */
  async function runQuickScan(siteId: string) {
    const site = registry.get(siteId);
    if (!site) throw new Error("Not found");
    if (!vault.has(site.id)) {
      throw new Error("Authenticate first (Đăng nhập)");
    }
    await cancelLoginSession(site.id);
    await closeBrowserReplay(site.id);
    await closeBrowserSession(site.id);
    const { round } = registry.startExploreRound(
      site.id,
      `quick-scan ${site.explorePath}`,
    );
    const result = await exploreAndCapture({
      baseUrl: site.baseUrl,
      explorePath: site.explorePath,
      profileDir: site.profileDir,
    });
    vault.set(site.id, result.authSnapshot);
    const normalized = normalizeCandidates(result.candidates, site.baseUrl);
    const { site: updated, added } = registry.mergeSiteCandidates(site.id, normalized, {
      exploreRound: round.id,
      focus: `quick-scan ${site.explorePath}`,
    });
    const pageUrl = new URL(site.explorePath, site.baseUrl).toString();
    const withIr = persistCapture(
      { registry },
      site.id,
      normalized,
      { pageUrl, gesture: "goto" },
      round.id,
    );
    return { site: withIr, candidateCount: withIr.candidates.length, added: added.length };
  }

  app.post("/api/sites/:id/explore", async (c) => {
    try {
      const result = await runQuickScan(c.req.param("id"));
      return c.json(result);
    } catch (err) {
      const id = c.req.param("id");
      registry.update(id, { status: vault.has(id) ? "ready" : "needs_auth" });
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("Authenticate") ? 400 : message === "Not found" ? 404 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/sites/:id/explore/quick", async (c) => {
    try {
      const result = await runQuickScan(c.req.param("id"));
      return c.json(result);
    } catch (err) {
      const id = c.req.param("id");
      registry.update(id, { status: vault.has(id) ? "ready" : "needs_auth" });
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("Authenticate") ? 400 : message === "Not found" ? 404 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/sites/:id/chat", (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    return c.json({
      messages: site.chatMessages,
      agentId: site.chatAgentId,
      focus: site.exploreFocus,
      rounds: site.exploreRounds,
    });
  });

  app.post("/api/sites/:id/chat", async (c) => {
    const body = await c.req.json();
    return handleChatSse({
      siteId: c.req.param("id"),
      body,
      registry,
      vault,
      cursorApiKey: env.cursorApiKey,
    });
  });

  app.post("/api/sites/:id/propose", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    if (!isCursorSdkConfigured(env.cursorApiKey)) {
      return c.json(
        {
          error: "CURSOR_API_KEY not configured. Use Manual select instead.",
          code: "CURSOR_SDK_UNAVAILABLE",
        },
        400,
      );
    }
    if (site.candidates.length === 0) {
      return c.json({ error: "No candidates. Chat explore or Quick scan first." }, 400);
    }

    try {
      const proposed = await proposeToolsWithCursorSdk({
        apiKey: env.cursorApiKey,
        candidates: site.candidates,
        siteName: site.name,
        baseUrl: site.baseUrl,
        cwd: ROOT_DIR,
      });
      const updated = registry.update(site.id, { proposedTools: proposed });
      return c.json({ site: updated, proposed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/sites/:id/approve", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    const body = ApproveToolsInputSchema.parse(await c.req.json());

    let incoming: ReturnType<typeof ToolDefSchema.parse>[] = [];
    if (body.tools?.length) {
      incoming = body.tools.map((t) => ToolDefSchema.parse(t));
    } else if (body.candidateIds?.length) {
      try {
        approveCandidatesOp(siteOps(), site.id, {
          candidateIds: body.candidateIds,
          confirm: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 400);
      }
      return c.json({ site: registry.get(site.id) });
    } else if (body.toolNames?.length) {
      incoming = site.proposedTools.filter((t) => body.toolNames!.includes(t.name));
      if (incoming.length === 0) {
        incoming = site.tools.filter((t) => body.toolNames!.includes(t.name));
      }
    } else {
      return c.json(
        { error: "Provide tools, candidateIds, or toolNames to approve" },
        400,
      );
    }

    const tools = mergeTools(
      site.tools,
      upgradeTools(incoming.map((t) => ({ ...t, approved: true }))),
    );
    try {
      assertToolsOrigin(site, incoming);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
    const updated = registry.update(site.id, { tools });
    return c.json({ site: updated });
  });

  app.post("/api/sites/:id/tools/:toolName/try", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    const toolName = decodeURIComponent(c.req.param("toolName"));
    const tool = site.tools.find((t) => t.name === toolName);
    if (!tool) return c.json({ error: `Tool not found: ${toolName}` }, 404);
    if (tool.approved !== true) {
      return c.json({ error: `Tool not approved: ${toolName}` }, 403);
    }
    if (!vault.has(site.id)) {
      return c.json({ error: "No auth in vault — login first" }, 400);
    }
    const body = z
      .object({ args: z.record(z.unknown()).optional() })
      .parse(await c.req.json().catch(() => ({})));
    const auth = vault.get(site.id);
    if (!auth) {
      return c.json({ error: "No auth in vault — login first" }, 400);
    }
    try {
      const result = await siteReplay(site)(tool, body.args ?? {}, auth);
      const formatted = formatReplayResult(result, tool);
      return c.json(formatted.structuredContent);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        return c.json({ error: err.message }, 401);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/sites/:id/cursor-mcp", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    const { path, exists, mcpServers } = readCursorMcpConfig();
    const key = site.cursorMcpKey;
    const siteEntry = mcpServers[key] ?? null;
    return c.json({
      path,
      exists,
      key,
      registered: siteEntry != null,
      servers: mcpServers,
      siteEntry,
      document: { mcpServers },
    });
  });

  app.post("/api/sites/:id/register-cursor", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    if (site.tools.length === 0) {
      return c.json({ error: "Approve at least one tool before registering" }, 400);
    }

    const runtimeEntry = resolve(ROOT_DIR, "packages/mcp-runtime/dist/cli.js");
    const entry = buildMcpEntry(site, {
      runtimeEntry,
      dataDir: env.dataDir,
      masterKey: env.masterKey,
    });
    const mcpPath = defaultCursorMcpPath();
    mergeCursorMcpConfig(mcpPath, site.cursorMcpKey, entry);
    return c.json({
      ok: true,
      mcpPath,
      key: site.cursorMcpKey,
      entry: {
        command: entry.command,
        args: entry.args,
        env: { AUTO_MCP_MASTER_KEY: "(set)" },
      },
    });
  });

  app.put("/api/sites/:id/explore-path", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    const body = z.object({ explorePath: z.string().min(1) }).parse(await c.req.json());
    const updated = registry.update(site.id, { explorePath: body.explorePath });
    return c.json({ site: updated });
  });

  app.put("/api/sites/:id/replay-mode", async (c) => {
    const site = registry.get(c.req.param("id"));
    if (!site) return c.json({ error: "Not found" }, 404);
    const body = z
      .object({ replayMode: z.enum(["http", "browser"]) })
      .parse(await c.req.json());
    const updated = registry.update(site.id, { replayMode: body.replayMode });
    return c.json({ site: updated });
  });

  return app;
}
