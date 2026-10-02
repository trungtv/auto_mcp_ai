import { Agent, type SDKCustomTool } from "@cursor/sdk";
import type { ChatActivityStep, ChatMessage } from "@auto-mcp/shared";
import { randomUUID } from "node:crypto";
import type { SiteInventorySnapshot } from "./browser-tools.js";

export type ChatStreamEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; text: string; done?: boolean }
  | { type: "token"; text: string }
  | {
      type: "tool";
      callId: string;
      name: string;
      status: "started" | "completed" | "error";
      argsSummary?: string;
      resultSummary?: string;
    }
  | { type: "assistant_done"; text: string }
  | { type: "error"; message: string }
  | { type: "agent"; agentId: string };

const SYSTEM_PREAMBLE = `You are the explore + publish + pack-author agent for auto_mcp_ai.
You discover real HTTP APIs on an authenticated website, compile them through Endpoint IR into primitives,
publish capabilities to MCP in-app, and MAY edit site pack TypeScript under a narrow sandbox when the user asks for a new/changed formatter.

Rules:
- Only explore according to the user's stated focus. Do not crawl the whole site blindly.
- Use the provided custom tools only — not ambient MCP guessing, not workbook paths.
- Inventory: list_endpoint_ir, list_capability_graph, list_observed_actions, list_site_tools, list_site_capabilities, analyze_coverage, list_candidates.
- When the user asks what is already done / gaps: call analyze_coverage (IR.key ↔ primitive + lastContract/lastMutation) + list_capability_graph. Never ask them to paste tool names.
- Discover loop:
  1) browser_* then network_snapshot (records ObservedAction + last UI gesture).
  2) list_endpoint_ir — this is the source of truth. Do NOT invent endpoints.
  3) Propose semantic names (search vs search_autocomplete) via rename_endpoint_ir if the heuristic is weak.
  4) User confirms in chat → compile_endpoints confirm:true (or approve_candidates confirm:true). Never compile without confirm.
  5) test_endpoint_ir confirm:true (mutate:true only for JSON data_api with a query param that has ≥2 samples; frozen/GWT mutate throws).
  6) Propose upsert_capability (optional bind.endpointIrId or bind.endpointIrIds 1:N; each IR compiled; runtime picks lastContract.ok newest) → confirm → try_capability → register_site_mcp confirm:true.
- Pack authoring (only when user wants formatter/adapter code changes):
  - Scope is ONLY packages/site-adapter-<pack>/src/ (demo: jira) via list_pack_files, read_pack_file, apply_pack_patch, write_pack_file, run_pack_tests.
  - Prefer apply_pack_patch (exact oldString→newString) for edits to existing files. Use write_pack_file only to create new files, or overwrite:true for intentional full rewrite.
  - apply_pack_patch / write_pack_file REQUIRE confirm:true after the user explicitly agrees in chat.
  - After every successful patch/write, tests run automatically; if tests fail, fix with another confirmed patch or report failure — do not leave silently.
  - Do NOT edit files outside the pack folder (no registry.ts). New packs: separate repo + adapters.extra.ts (see packages/site-adapters/src/ADD_SITE.md).
- Write tools (compile_endpoints / approve_candidates / test_endpoint_ir / upsert / register / apply_pack_patch / write_pack_file) MUST use confirm:true only after user agreement. Without confirm → preview/refuse.
- Never invent endpoints or graph edges. Never compile kind=other (assets). Never persist test evidence without confirm.
- Prefer network_snapshot after meaningful UI actions.
- Reply in Vietnamese if the user writes in Vietnamese.
`;

const SUMMARY_MAX = 1500;

export function summarizePayload(value: unknown, maxChars = SUMMARY_MAX): string | undefined {
  if (value === undefined || value === null) return undefined;
  let raw: string;
  try {
    raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    raw = String(value);
  }
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n…[truncated ${raw.length - maxChars} chars]`;
}

export function formatInventoryForPrompt(inv: SiteInventorySnapshot): string {
  const primLines =
    inv.primitives.length === 0
      ? "- (none yet)"
      : inv.primitives
          .slice(0, 40)
          .map(
            (t) =>
              `- ${t.name}${t.approved === false ? " (not approved)" : ""} ${t.method ?? ""} ${t.url ?? ""}`.trim(),
          )
          .join("\n");
  const capLines =
    inv.capabilities.length === 0
      ? "- (none yet)"
      : inv.capabilities
          .slice(0, 40)
          .map((c) => {
            const bind =
              c.bind && typeof c.bind === "object" && c.bind !== null && "kind" in c.bind
                ? ` bind=${JSON.stringify(c.bind)}`
                : "";
            return `- ${c.name}${c.title ? ` — ${c.title}` : ""}${bind}`;
          })
          .join("\n");
  return `## Already built on this site (registry — not workbook)
Adapter: ${inv.adapterId}
Pack folder: packages/site-adapter-<pack>/src/ — use list_pack_files; default pack follows adapter when possible
Primitives (${inv.primitives.length}):
${primLines}
Capabilities / MCP tools (${inv.capabilities.length}):
${capLines}
Seeds: ${inv.seedCapabilityNames.join(", ") || "(none)"}
Stored defs: ${inv.storedCapabilityNames.join(", ") || "(none)"}`;
}

export interface SiteChatContext {
  apiKey?: string;
  cwd: string;
  siteName: string;
  baseUrl: string;
  explorePath: string;
  agentId: string | null;
  customTools: Record<string, SDKCustomTool>;
  /** Injected each turn so the agent sees current registry inventory. */
  inventory: SiteInventorySnapshot;
}

function agentOptions(ctx: SiteChatContext) {
  return {
    ...(ctx.apiKey ? { apiKey: ctx.apiKey } : {}),
    model: { id: "auto" as const },
    tools: ["mcp"] as ("mcp")[],
    local: {
      cwd: ctx.cwd,
      customTools: ctx.customTools,
    },
  };
}

export async function ensureChatAgent(
  ctx: SiteChatContext,
): Promise<{ agent: Awaited<ReturnType<typeof Agent.create>>; agentId: string }> {
  const opts = agentOptions(ctx);

  if (ctx.agentId) {
    try {
      const agent = await Agent.resume(ctx.agentId, opts);
      return { agent, agentId: ctx.agentId };
    } catch {
      /* create fresh */
    }
  }

  const agent = await Agent.create({
    ...opts,
    name: `auto-mcp-${ctx.siteName}`,
  });

  return { agent, agentId: agent.agentId };
}

function extractAssistantText(event: unknown): string {
  const e = event as {
    type?: string;
    message?: { content?: Array<{ type?: string; text?: string }> };
  };
  if (e.type !== "assistant" || !e.message?.content) return "";
  let out = "";
  for (const block of e.message.content) {
    if (block.type === "text" && block.text) out += block.text;
  }
  return out;
}

function resolveToolName(name: string | undefined, args: unknown): string {
  if (name && name !== "mcp") return name;
  if (args && typeof args === "object" && args !== null && "toolName" in args) {
    const tn = (args as { toolName?: unknown }).toolName;
    if (typeof tn === "string" && tn.trim()) return tn;
  }
  return name ?? "tool";
}

function toolEvent(event: unknown): ChatStreamEvent | null {
  const e = event as {
    type?: string;
    call_id?: string;
    name?: string;
    status?: "running" | "completed" | "error";
    args?: unknown;
    result?: unknown;
  };
  if (e.type !== "tool_call") return null;
  const status =
    e.status === "completed" ? "completed" : e.status === "error" ? "error" : "started";
  return {
    type: "tool",
    callId: e.call_id ?? e.name ?? randomUUID(),
    name: resolveToolName(e.name, e.args),
    status,
    argsSummary: summarizePayload(e.args),
    resultSummary:
      e.status === "completed" || e.status === "error"
        ? summarizePayload(e.result)
        : undefined,
  };
}

export async function* streamSiteChat(
  ctx: SiteChatContext,
  userMessage: string,
): AsyncGenerator<ChatStreamEvent> {
  yield {
    type: "status",
    message: ctx.apiKey
      ? "Đang khởi tạo Cursor agent…"
      : "Đang khởi tạo Cursor agent (không có CURSOR_API_KEY — thử credential local của Cursor)…",
  };

  let agent: Awaited<ReturnType<typeof Agent.create>> | null = null;
  try {
    const ensured = await ensureChatAgent(ctx);
    agent = ensured.agent;
    yield { type: "agent", agentId: ensured.agentId };
    yield { type: "status", message: "Agent sẵn sàng — đang gửi yêu cầu explore…" };

    const primed = `${SYSTEM_PREAMBLE}

Site: ${ctx.siteName}
Base URL: ${ctx.baseUrl}
Default explore path: ${ctx.explorePath}

${formatInventoryForPrompt(ctx.inventory)}

User message:
${userMessage}`;

    let full = "";
    let thinkingText = "";
    const run = await agent.send(primed, {
      local: { customTools: ctx.customTools },
    });

    for await (const event of run.stream()) {
      const evType = (event as { type?: string }).type;

      if (evType === "thinking") {
        const delta = (event as { text?: string }).text ?? "";
        if (delta) thinkingText += delta;
        yield {
          type: "thinking",
          text: summarizePayload(thinkingText, 4000) ?? thinkingText,
          ...(delta ? {} : { done: true }),
        };
        if (!delta) thinkingText = "";
        continue;
      }

      const te = toolEvent(event);
      if (te) {
        if (thinkingText) {
          yield { type: "thinking", text: thinkingText, done: true };
          thinkingText = "";
        }
        yield te;
      }

      if (evType === "status") {
        const st = event as { status?: string; message?: string };
        yield {
          type: "status",
          message: st.message ?? `Agent status: ${st.status ?? "running"}`,
        };
      }

      const text = extractAssistantText(event);
      if (text) {
        if (thinkingText) {
          yield { type: "thinking", text: thinkingText, done: true };
          thinkingText = "";
        }
        if (text.startsWith(full)) {
          const delta = text.slice(full.length);
          if (delta) {
            full = text;
            yield { type: "token", text: delta };
          }
        } else {
          full += text;
          yield { type: "token", text };
        }
      }
    }

    if (thinkingText) {
      yield { type: "thinking", text: thinkingText, done: true };
    }

    const result = await run.wait();
    if (result.status !== "finished") {
      yield {
        type: "error",
        message:
          result.error?.message ??
          `Cursor run ${result.status}${result.result ? `: ${result.result}` : ""}`,
      };
    }
    if (!full && result.result) {
      full = result.result;
      yield { type: "token", text: full };
    }
    if (!full.trim() && result.status === "finished") {
      yield {
        type: "status",
        message: "Agent kết thúc nhưng không có text — có thể chỉ gọi tool. Kiểm tra candidates.",
      };
    }
    yield { type: "assistant_done", text: full };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = /api.?key|auth|401|unauthorized/i.test(message)
      ? " Thêm CURSOR_API_KEY vào file .env ở root repo rồi restart `pnpm dev`."
      : "";
    yield { type: "error", message: `${message}${hint}` };
  } finally {
    await agent?.[Symbol.asyncDispose]?.().catch(() => undefined);
  }
}

export function makeChatMessage(
  role: ChatMessage["role"],
  content: string,
  extras?: { toolName?: string; activity?: ChatActivityStep[] },
): ChatMessage {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    toolName: extras?.toolName,
    activity: extras?.activity,
  };
}

/** Convert stream events into persistable activity steps (dedupe tools by callId). */
export function collectActivityFromEvents(
  events: ChatStreamEvent[],
): ChatActivityStep[] {
  const steps: ChatActivityStep[] = [];
  const toolIndex = new Map<string, number>();

  for (const ev of events) {
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
  return steps;
}
