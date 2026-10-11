#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(homedir(), ".cache", "ms-playwright");
const hasChromium = existsSync(cache) && spawnSync("ls", [cache], { encoding: "utf8" }).stdout.includes("chromium");

if (hasChromium) {
  console.log("Playwright chromium cache present — skip install");
  process.exit(0);
}

const r = spawnSync(
  "pnpm",
  ["--filter", "@auto-mcp/browser-auth", "exec", "playwright", "install", "chromium"],
  { cwd: root, stdio: "inherit", env: process.env },
);
process.exit(r.status ?? 1);
