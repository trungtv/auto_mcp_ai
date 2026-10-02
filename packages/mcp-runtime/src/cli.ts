#!/usr/bin/env node
import { resolve } from "node:path";
import { startMcpServer } from "./server.js";

function usage(): never {
  console.error("Usage: auto-mcp-runtime --site <siteId> [--data-dir <path>]");
  process.exit(1);
}

const args = process.argv.slice(2);
let siteId = "";
let dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), ".data");

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--site") siteId = args[++i] ?? "";
  else if (a === "--data-dir") dataDir = resolve(args[++i] ?? dataDir);
  else if (a === "--help" || a === "-h") usage();
}

if (!siteId) usage();

const masterKey = process.env.AUTO_MCP_MASTER_KEY;
if (!masterKey) {
  console.error("AUTO_MCP_MASTER_KEY is required");
  process.exit(1);
}

await startMcpServer({ siteId, dataDir, masterKey });
