#!/usr/bin/env node
import { resolve } from "node:path";
import { resolveDataDir } from "./paths.js";
import { startControlMcpServer } from "./server.js";

function usage(): never {
  console.error("Usage: auto-mcp-control [--data-dir <path>]");
  process.exit(1);
}

const args = process.argv.slice(2);
let dataDirArg: string | undefined;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--data-dir") dataDirArg = args[++i];
  else if (a === "--help" || a === "-h") usage();
  else usage();
}

const masterKey = process.env.AUTO_MCP_MASTER_KEY;
if (!masterKey) {
  console.error("AUTO_MCP_MASTER_KEY is required (set in .env or env)");
  process.exit(1);
}

const dataDir = resolveDataDir(dataDirArg);
await startControlMcpServer({
  dataDir: resolve(dataDir),
  masterKey,
});
