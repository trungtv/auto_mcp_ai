import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type ApiCandidate,
  type CapabilityDef,
  type ChatMessage,
  type CreateSiteInput,
  type EndpointIr,
  type ExploreRound,
  type McpSite,
  type ObservedAction,
  type ServerStatus,
  type ToolDef,
  defaultCursorKey,
  uniqueCursorKey,
  slugify,
} from "@auto-mcp/shared";
import { mergeCandidates } from "@auto-mcp/explorer";

function nowIso(): string {
  return new Date().toISOString();
}

export class Registry {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, "registry.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        explore_path TEXT NOT NULL,
        status TEXT NOT NULL,
        cursor_mcp_key TEXT NOT NULL,
        profile_dir TEXT NOT NULL,
        tools_json TEXT NOT NULL DEFAULT '[]',
        candidates_json TEXT NOT NULL DEFAULT '[]',
        proposed_tools_json TEXT NOT NULL DEFAULT '[]',
        chat_agent_id TEXT,
        chat_messages_json TEXT NOT NULL DEFAULT '[]',
        explore_rounds_json TEXT NOT NULL DEFAULT '[]',
        explore_focus TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_auth_at TEXT,
        last_explore_at TEXT,
        notes TEXT
      );
    `);
    this.ensureColumn("chat_agent_id", "TEXT");
    this.ensureColumn("chat_messages_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("explore_rounds_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("explore_focus", "TEXT");
    this.ensureColumn("capabilities_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("replay_mode", "TEXT NOT NULL DEFAULT 'http'");
    this.ensureColumn("observed_actions_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("endpoint_ir_json", "TEXT NOT NULL DEFAULT '[]'");
  }

  private ensureColumn(name: string, typeSql: string): void {
    const cols = this.db.prepare("PRAGMA table_info(sites)").all() as Array<{
      name: string;
    }>;
    if (cols.some((c) => c.name === name)) return;
    this.db.exec(`ALTER TABLE sites ADD COLUMN ${name} ${typeSql}`);
  }

  private rowToSite(row: Record<string, unknown>): McpSite {
    return {
      id: String(row.id),
      name: String(row.name),
      baseUrl: String(row.base_url),
      explorePath: String(row.explore_path),
      status: row.status as ServerStatus,
      cursorMcpKey: String(row.cursor_mcp_key),
      profileDir: String(row.profile_dir),
      tools: JSON.parse(String(row.tools_json)) as ToolDef[],
      candidates: JSON.parse(String(row.candidates_json)) as ApiCandidate[],
      proposedTools: JSON.parse(String(row.proposed_tools_json)) as ToolDef[],
      capabilities: JSON.parse(
        String(row.capabilities_json ?? "[]"),
      ) as CapabilityDef[],
      chatAgentId: row.chat_agent_id ? String(row.chat_agent_id) : null,
      chatMessages: JSON.parse(String(row.chat_messages_json ?? "[]")) as ChatMessage[],
      exploreRounds: JSON.parse(String(row.explore_rounds_json ?? "[]")) as ExploreRound[],
      exploreFocus: row.explore_focus ? String(row.explore_focus) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastAuthAt: row.last_auth_at ? String(row.last_auth_at) : null,
      lastExploreAt: row.last_explore_at ? String(row.last_explore_at) : null,
      notes: row.notes ? String(row.notes) : undefined,
      replayMode: row.replay_mode === "browser" ? "browser" : "http",
      observedActions: JSON.parse(
        String(row.observed_actions_json ?? "[]"),
      ) as ObservedAction[],
      endpointIr: JSON.parse(
        String(row.endpoint_ir_json ?? "[]"),
      ) as EndpointIr[],
    };
  }

  list(): McpSite[] {
    const rows = this.db
      .prepare("SELECT * FROM sites ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToSite(r));
  }

  get(id: string): McpSite | null {
    const row = this.db.prepare("SELECT * FROM sites WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToSite(row) : null;
  }

  create(input: CreateSiteInput, profileDir: string): McpSite {
    const id = randomUUID();
    const createdAt = nowIso();
    const base = new URL(input.baseUrl);
    const name = input.name ?? base.hostname;
    const explorePath =
      input.explorePath ??
      "/";
    const taken = this.list().map((s) => s.cursorMcpKey);
    const site: McpSite = {
      id,
      name,
      baseUrl: `${base.origin}/`,
      explorePath,
      status: "needs_auth",
      cursorMcpKey: uniqueCursorKey(defaultCursorKey(`${base.origin}/`), taken, id),
      profileDir,
      tools: [],
      candidates: [],
      proposedTools: [],
      capabilities: [],
      chatAgentId: null,
      chatMessages: [],
      exploreRounds: [],
      exploreFocus: null,
      createdAt,
      updatedAt: createdAt,
      lastAuthAt: null,
      lastExploreAt: null,
      replayMode: "http",
      observedActions: [],
      endpointIr: [],
    };

    this.db
      .prepare(
        `INSERT INTO sites (
          id, name, base_url, explore_path, status, cursor_mcp_key, profile_dir,
          tools_json, candidates_json, proposed_tools_json, capabilities_json,
          chat_agent_id, chat_messages_json, explore_rounds_json, explore_focus,
          created_at, updated_at, last_auth_at, last_explore_at, replay_mode,
          observed_actions_json, endpoint_ir_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        site.id,
        site.name,
        site.baseUrl,
        site.explorePath,
        site.status,
        site.cursorMcpKey,
        site.profileDir,
        JSON.stringify(site.tools),
        JSON.stringify(site.candidates),
        JSON.stringify(site.proposedTools),
        JSON.stringify(site.capabilities),
        site.chatAgentId,
        JSON.stringify(site.chatMessages),
        JSON.stringify(site.exploreRounds),
        site.exploreFocus,
        site.createdAt,
        site.updatedAt,
        site.lastAuthAt,
        site.lastExploreAt,
        site.replayMode,
        JSON.stringify(site.observedActions),
        JSON.stringify(site.endpointIr),
      );

    return site;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        McpSite,
        | "name"
        | "status"
        | "cursorMcpKey"
        | "tools"
        | "candidates"
        | "proposedTools"
        | "capabilities"
        | "chatAgentId"
        | "chatMessages"
        | "exploreRounds"
        | "exploreFocus"
        | "lastAuthAt"
        | "lastExploreAt"
        | "notes"
        | "explorePath"
        | "profileDir"
        | "replayMode"
        | "observedActions"
        | "endpointIr"
      >
    >,
  ): McpSite {
    const current = this.get(id);
    if (!current) throw new Error(`Site not found: ${id}`);
    const next: McpSite = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    this.db
      .prepare(
        `UPDATE sites SET
          name = ?, status = ?, cursor_mcp_key = ?, explore_path = ?, profile_dir = ?,
          tools_json = ?, candidates_json = ?, proposed_tools_json = ?, capabilities_json = ?,
          chat_agent_id = ?, chat_messages_json = ?, explore_rounds_json = ?, explore_focus = ?,
          updated_at = ?, last_auth_at = ?, last_explore_at = ?, notes = ?, replay_mode = ?,
          observed_actions_json = ?, endpoint_ir_json = ?
        WHERE id = ?`,
      )
      .run(
        next.name,
        next.status,
        next.cursorMcpKey,
        next.explorePath,
        next.profileDir,
        JSON.stringify(next.tools),
        JSON.stringify(next.candidates),
        JSON.stringify(next.proposedTools),
        JSON.stringify(next.capabilities ?? []),
        next.chatAgentId,
        JSON.stringify(next.chatMessages),
        JSON.stringify(next.exploreRounds),
        next.exploreFocus,
        next.updatedAt,
        next.lastAuthAt,
        next.lastExploreAt,
        next.notes ?? null,
        next.replayMode,
        JSON.stringify(next.observedActions ?? []),
        JSON.stringify(next.endpointIr ?? []),
        id,
      );
    return next;
  }

  mergeSiteCandidates(
    id: string,
    incoming: ApiCandidate[],
    meta?: { exploreRound?: number; focus?: string },
  ): { site: McpSite; added: ApiCandidate[] } {
    const current = this.get(id);
    if (!current) throw new Error(`Site not found: ${id}`);
    const { merged, added } = mergeCandidates(current.candidates, incoming, {
      exploreRound: meta?.exploreRound,
    });
    const rounds = [...current.exploreRounds];
    if (meta?.exploreRound != null) {
      const idx = rounds.findIndex((r) => r.id === meta.exploreRound);
      if (idx >= 0) {
        rounds[idx] = {
          ...rounds[idx]!,
          finishedAt: nowIso(),
          newCandidateCount: added.length,
          focus: meta.focus ?? rounds[idx]!.focus,
        };
      }
    }
    const site = this.update(id, {
      candidates: merged,
      exploreRounds: rounds,
      exploreFocus: meta?.focus ?? current.exploreFocus,
      lastExploreAt: nowIso(),
      status: "ready",
    });
    return { site, added };
  }

  appendChatMessage(id: string, message: ChatMessage): McpSite {
    const current = this.get(id);
    if (!current) throw new Error(`Site not found: ${id}`);
    return this.update(id, {
      chatMessages: [...current.chatMessages, message],
    });
  }

  startExploreRound(id: string, focus: string): { site: McpSite; round: ExploreRound } {
    const current = this.get(id);
    if (!current) throw new Error(`Site not found: ${id}`);
    const round: ExploreRound = {
      id: (current.exploreRounds.at(-1)?.id ?? 0) + 1,
      focus,
      startedAt: nowIso(),
      newCandidateCount: 0,
    };
    const site = this.update(id, {
      exploreRounds: [...current.exploreRounds, round],
      exploreFocus: focus,
      status: "exploring",
    });
    return { site, round };
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM sites WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  profileDirFor(dataDir: string, siteId: string, baseUrl: string): string {
    return join(dataDir, "profiles", `${slugify(baseUrl)}-${siteId.slice(0, 8)}`);
  }
}
