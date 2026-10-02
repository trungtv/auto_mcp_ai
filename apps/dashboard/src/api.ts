import type { ApiCandidate, ChatMessage, ExploreRound, McpSite, ToolDef } from "@auto-mcp/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

/** Retry when control-plane is still booting (proxy ECONNREFUSED → failed fetch). */
export async function requestWithRetry<T>(
  fn: () => Promise<T>,
  attempts = 20,
  delayMs = 250,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type ChatSseEvent =
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
  | { type: "agent"; agentId: string }
  | { type: "candidates"; total: number }
  | { type: "done"; site?: McpSite; candidateCount?: number };

export async function streamChat(
  siteId: string,
  message: string,
  onEvent: (ev: ChatSseEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/sites/${siteId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part
        .split("\n")
        .find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as ChatSseEvent);
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}

export const api = {
  health: () => request<{ ok: boolean; cursorSdk: boolean }>("/api/health"),
  listSites: () => request<{ sites: McpSite[] }>("/api/sites"),
  getSite: (id: string) =>
    request<{ site: McpSite; hasAuth: boolean }>(`/api/sites/${id}`),
  getCapabilities: (id: string) =>
    request<{
      adapterId: string;
      primitiveCount: number;
      supportsArgMutation?: { semester?: boolean; classId?: boolean };
      stored?: Array<Record<string, unknown>>;
      seeds?: Array<{
        name: string;
        title?: string;
        description: string;
        supportsMutation: boolean;
        bind?: Record<string, unknown>;
        inputSchema: Record<string, unknown>;
      }>;
      capabilities: Array<{
        name: string;
        title?: string;
        description: string;
        supportsMutation: boolean;
        bind?: Record<string, unknown>;
        inputSchema: Record<string, unknown>;
        annotations?: Record<string, unknown>;
      }>;
    }>(`/api/sites/${id}/capabilities`),
  createSite: (body: { name?: string; baseUrl: string; explorePath?: string }) =>
    request<{ site: McpSite }>("/api/sites", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteSite: (id: string) =>
    request<{ ok: boolean }>(`/api/sites/${id}`, { method: "DELETE" }),
  login: (id: string) =>
    request<{ ok: boolean; awaitingConfirm: boolean; message: string }>(
      `/api/sites/${id}/login`,
      { method: "POST" },
    ),
  loginConfirm: (id: string) =>
    request<{ site: McpSite; hasAuth: boolean }>(`/api/sites/${id}/login/confirm`, {
      method: "POST",
    }),
  loginCancel: (id: string) =>
    request<{ ok: boolean }>(`/api/sites/${id}/login/cancel`, { method: "POST" }),
  loginStatus: (id: string) =>
    request<{ awaitingConfirm: boolean }>(`/api/sites/${id}/login/status`),
  explore: (id: string) =>
    request<{ site: McpSite; candidateCount: number; added?: number }>(
      `/api/sites/${id}/explore/quick`,
      { method: "POST" },
    ),
  getChat: (id: string) =>
    request<{
      messages: ChatMessage[];
      agentId: string | null;
      focus: string | null;
      rounds: ExploreRound[];
    }>(`/api/sites/${id}/chat`),
  propose: (id: string) =>
    request<{ site: McpSite; proposed: ToolDef[] }>(`/api/sites/${id}/propose`, {
      method: "POST",
    }),
  approve: (
    id: string,
    body: { candidateIds?: string[]; toolNames?: string[]; tools?: ToolDef[] },
  ) =>
    request<{ site: McpSite }>(`/api/sites/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setReplayMode: (id: string, replayMode: "http" | "browser") =>
    request<{ site: McpSite }>(`/api/sites/${id}/replay-mode`, {
      method: "PUT",
      body: JSON.stringify({ replayMode }),
    }),
  registerCursor: (id: string) =>
    request<{
      ok: boolean;
      mcpPath: string;
      key: string;
      entry?: {
        command: string;
        args: string[];
        env?: Record<string, string>;
      };
    }>(`/api/sites/${id}/register-cursor`, { method: "POST" }),
  getCursorMcp: (id: string) =>
    request<{
      path: string;
      exists: boolean;
      key: string;
      registered: boolean;
      servers: Record<
        string,
        { command: string; args: string[]; env?: Record<string, string> }
      >;
      siteEntry: {
        command: string;
        args: string[];
        env?: Record<string, string>;
      } | null;
      document: {
        mcpServers: Record<
          string,
          { command: string; args: string[]; env?: Record<string, string> }
        >;
      };
    }>(`/api/sites/${id}/cursor-mcp`),
  tryTool: (id: string, toolName: string, args?: Record<string, unknown>) =>
    request<{
      status: number;
      ok: boolean;
      bodyPreview: string;
      truncated: boolean;
      contentTypeHint: string;
      byteLength: number;
      captureContext?: Record<string, unknown>;
    }>(`/api/sites/${id}/tools/${encodeURIComponent(toolName)}/try`, {
      method: "POST",
      body: JSON.stringify({ args: args ?? {} }),
    }),
  tryCapability: (id: string, name: string, args?: Record<string, unknown>) =>
    request<{
      status?: number;
      ok?: boolean;
      rawPreview?: string;
      rawBody?: string;
      bodyPreview?: string;
      truncated?: boolean;
      byteLength?: number;
      semester?: string;
      classId?: string;
      projectType?: string;
      mutated?: boolean;
      count?: number;
      students?: Array<Record<string, unknown>>;
      projects?: Array<Record<string, unknown>>;
      classes?: Array<Record<string, unknown>>;
      loggedIn?: boolean;
      identity?: Record<string, unknown>;
      parseError?: string;
      isError?: boolean;
      text?: string;
      captureContext?: Record<string, unknown>;
    }>(`/api/sites/${id}/capabilities/${encodeURIComponent(name)}/try`, {
      method: "POST",
      body: JSON.stringify({ args: args ?? {} }),
    }),
};

export type { ApiCandidate, ChatMessage, McpSite, ToolDef };
