import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { McpSite } from "@auto-mcp/shared";

export interface CursorMcpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function defaultCursorMcpPath(): string {
  if (process.env.CURSOR_MCP_PATH) {
    return process.env.CURSOR_MCP_PATH;
  }
  return join(homedir(), ".cursor", "mcp.json");
}

export function buildMcpEntry(
  site: McpSite,
  opts: { runtimeEntry: string; dataDir: string; masterKey: string },
): CursorMcpEntry {
  return {
    command: "node",
    args: [opts.runtimeEntry, "--site", site.id, "--data-dir", opts.dataDir],
    env: {
      AUTO_MCP_MASTER_KEY: opts.masterKey,
    },
  };
}

/** Fixed mcp.json key for the meta control-plane MCP. */
export const CONTROL_MCP_KEY = "auto_mcp_ai";

export function buildControlMcpEntry(opts: {
  controlEntry: string;
  dataDir: string;
  masterKey: string;
}): CursorMcpEntry {
  return {
    command: "node",
    args: [opts.controlEntry, "--data-dir", opts.dataDir],
    env: {
      AUTO_MCP_MASTER_KEY: opts.masterKey,
    },
  };
}

export function registerControlMcp(opts: {
  controlEntry: string;
  dataDir: string;
  masterKey: string;
  mcpJsonPath?: string;
}): { mcpPath: string; key: string; entry: CursorMcpEntry } {
  const mcpPath = opts.mcpJsonPath ?? defaultCursorMcpPath();
  const entry = buildControlMcpEntry({
    controlEntry: opts.controlEntry,
    dataDir: opts.dataDir,
    masterKey: opts.masterKey,
  });
  mergeCursorMcpConfig(mcpPath, CONTROL_MCP_KEY, entry);
  return { mcpPath, key: CONTROL_MCP_KEY, entry };
}

export function mergeCursorMcpConfig(
  mcpJsonPath: string,
  key: string,
  entry: CursorMcpEntry,
): void {
  mkdirSync(dirname(mcpJsonPath), { recursive: true });
  let current: { mcpServers?: Record<string, CursorMcpEntry> } = {};
  if (existsSync(mcpJsonPath)) {
    current = JSON.parse(readFileSync(mcpJsonPath, "utf8")) as typeof current;
  }
  current.mcpServers = current.mcpServers ?? {};
  current.mcpServers[key] = entry;
  writeFileSync(mcpJsonPath, `${JSON.stringify(current, null, 2)}\n`);
}

export function removeCursorMcpConfig(mcpJsonPath: string, key: string): void {
  if (!existsSync(mcpJsonPath)) return;
  const current = JSON.parse(readFileSync(mcpJsonPath, "utf8")) as {
    mcpServers?: Record<string, CursorMcpEntry>;
  };
  if (!current.mcpServers?.[key]) return;
  delete current.mcpServers[key];
  writeFileSync(mcpJsonPath, `${JSON.stringify(current, null, 2)}\n`);
}

/** Redact env secrets for UI/API responses. */
export function redactMcpEntry(entry: CursorMcpEntry): CursorMcpEntry {
  const env = entry.env
    ? Object.fromEntries(
        Object.keys(entry.env).map((k) => [k, "(set)"] as const),
      )
    : undefined;
  return {
    command: entry.command,
    args: [...entry.args],
    ...(env ? { env } : {}),
  };
}

/**
 * Read ~/.cursor/mcp.json (or CURSOR_MCP_PATH) with env values redacted.
 * Does not throw if the file is missing.
 */
export function readCursorMcpConfig(mcpJsonPath?: string): {
  path: string;
  exists: boolean;
  mcpServers: Record<string, CursorMcpEntry>;
} {
  const path = mcpJsonPath ?? defaultCursorMcpPath();
  if (!existsSync(path)) {
    return { path, exists: false, mcpServers: {} };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    mcpServers?: Record<string, CursorMcpEntry>;
  };
  const servers = raw.mcpServers ?? {};
  const mcpServers: Record<string, CursorMcpEntry> = {};
  for (const [key, entry] of Object.entries(servers)) {
    if (entry && typeof entry === "object" && typeof entry.command === "string") {
      mcpServers[key] = redactMcpEntry(entry);
    }
  }
  return { path, exists: true, mcpServers };
}
