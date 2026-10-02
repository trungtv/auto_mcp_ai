#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiUrl = "http://127.0.0.1:3847/api/health";

function run(filter) {
  return spawn("pnpm", ["--filter", filter, "run", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

const api = run("@auto-mcp/control-plane");

/** Cold tsx + heavy workspace imports can take 15–25s on first boot. */
const pollMs = 250;
const maxAttempts = 200; // ~50s

let ready = false;
for (let i = 0; i < maxAttempts && !ready; i++) {
  try {
    const res = await fetch(apiUrl);
    if (res.ok) ready = true;
  } catch {
    /* not up yet */
  }
  if (!ready) {
    if (i > 0 && i % 20 === 0) {
      const sec = ((i * pollMs) / 1000).toFixed(0);
      console.log(`… still waiting for control-plane (${sec}s)`);
    }
    await sleep(pollMs);
  }
}

if (!ready) {
  const waitedSec = ((maxAttempts * pollMs) / 1000).toFixed(0);
  console.error(
    `Control plane did not become ready on :3847 after ~${waitedSec}s.`,
  );
  console.error(
    "Check: repo .env has AUTO_MCP_CONTROL_TOKEN (or AUTO_MCP_ALLOW_INSECURE_DEV=1), port 3847 free, and control-plane stderr above for errors.",
  );
  api.kill("SIGTERM");
  process.exit(1);
}

console.log("Control plane ready — starting dashboard");
const ui = run("@auto-mcp/dashboard");

function shutdown(signal) {
  ui.kill(signal);
  api.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const codes = await Promise.all([
  new Promise((r) => api.on("exit", (c) => r(c ?? 1))),
  new Promise((r) => ui.on("exit", (c) => r(c ?? 1))),
]);
process.exit(codes.find((c) => c !== 0) ?? 0);
