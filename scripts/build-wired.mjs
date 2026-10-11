#!/usr/bin/env node
/**
 * Build monorepo; when adapters.extra.ts is wired, break adapter<->pack cycle (two-pass).
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adaptersExtra = resolve(
  root,
  "packages/site-adapters/src/adapters.extra.ts",
);
const wiredBackup = resolve(root, ".adapters.extra.wired.ts");

function pnpm(args, cwd = root) {
  const r = spawnSync("pnpm", args, { cwd, stdio: "inherit", env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const wired = readFileSync(adaptersExtra, "utf8");
const isEmpty = /extraAdapters:\s*SiteAdapter\[\]\s*=\s*\[\s*\]/.test(wired);
if (isEmpty) {
  pnpm(["-r", "run", "build"]);
  console.log("build OK (no wired packs)");
  process.exit(0);
}

writeFileSync(wiredBackup, wired, "utf8");
writeFileSync(
  adaptersExtra,
  `import type { SiteAdapter } from "./types.js";
export const extraAdapters: SiteAdapter[] = [];
`,
  "utf8",
);

pnpm(["--filter", "@auto-mcp/shared", "run", "build"]);
pnpm(["--filter", "@auto-mcp/site-adapters", "run", "build"]);

const packFilters = [];
if (wired.includes("@auto-mcp/site-adapter-jira")) {
  packFilters.push("@auto-mcp/site-adapter-jira");
}
if (wired.includes("@entrade/")) {
  packFilters.push("@entrade/*");
}
if (packFilters.length > 0) {
  pnpm(["--filter", ...packFilters, "run", "build"]);
}

copyFileSync(wiredBackup, adaptersExtra);
pnpm(["--filter", "@auto-mcp/site-adapters", "run", "build"]);

const tail = [
  "@auto-mcp/browser-auth",
  "@auto-mcp/explorer",
  "@auto-mcp/mcp-generator",
  "@auto-mcp/vault",
  "@auto-mcp/compiler",
  "@auto-mcp/cursor-discover",
  "@auto-mcp/registry",
  "@auto-mcp/mcp-runtime",
  "@auto-mcp/mcp-control",
  "@auto-mcp/control-plane",
  "@auto-mcp/dashboard",
];
for (const pkg of tail) {
  pnpm(["--filter", pkg, "run", "build"]);
}

console.log("build:wired OK");
