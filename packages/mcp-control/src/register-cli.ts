#!/usr/bin/env node
/**
 * Register the meta MCP `auto_mcp_ai` into ~/.cursor/mcp.json
 */
import { resolve } from "node:path";
import { registerControlMcp } from "@auto-mcp/mcp-runtime";
import { controlCliPath, createControlContext } from "./context.js";
import { resolveDataDir } from "./paths.js";

const args = process.argv.slice(2);
let dataDirArg: string | undefined;
let mcpPath: string | undefined;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--data-dir") dataDirArg = args[++i];
  else if (a === "--mcp-path") mcpPath = args[++i];
  else if (a === "--help" || a === "-h") {
    console.error(
      "Usage: node dist/register-cli.js [--data-dir <path>] [--mcp-path <mcp.json>]",
    );
    process.exit(0);
  }
}

const masterKey = process.env.AUTO_MCP_MASTER_KEY;
if (!masterKey) {
  console.error("AUTO_MCP_MASTER_KEY is required");
  process.exit(1);
}

const dataDir = resolve(resolveDataDir(dataDirArg));
const ctx = createControlContext({ dataDir, masterKey });
const result = registerControlMcp({
  controlEntry: controlCliPath(ctx),
  dataDir,
  masterKey,
  mcpJsonPath: mcpPath,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      ...result,
      hint: "Reload MCP servers in Cursor to load auto_mcp_ai tools.",
    },
    null,
    2,
  ),
);
