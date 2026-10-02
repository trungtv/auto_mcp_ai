#!/usr/bin/env node
/**
 * Smoke / API E2E (no real browser login).
 * Usage: node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, ".data-smoke");
const mcpPath = resolve(dataDir, "mcp.json");
const base = "http://127.0.0.1:3848";

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const child = spawn(
  "pnpm",
  ["--filter", "@auto-mcp/control-plane", "exec", "tsx", "src/index.ts"],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: "3848",
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      AUTO_MCP_MASTER_KEY: "smoke-test-master-key-32chars!!",
      CURSOR_MCP_PATH: mcpPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let ready = false;
child.stdout.on("data", (b) => {
  const s = b.toString();
  if (s.includes("listening")) ready = true;
  process.stdout.write(s);
});
child.stderr.on("data", (b) => process.stderr.write(b));

for (let i = 0; i < 40 && !ready; i++) await sleep(250);
if (!ready) {
  child.kill();
  console.error("Control plane failed to start");
  process.exit(1);
}

async function api(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} → ${json.error ?? res.status}`);
  return json;
}

try {
  const health = await api("/api/health");
  if (!health.ok) throw new Error("health not ok");

  const created = await api("/api/sites", {
    method: "POST",
    body: JSON.stringify({
      name: "Jira Smoke",
      baseUrl: "https://example.atlassian.net",
      explorePath: "/",
    }),
  });
  const id = created.site.id;
  if (created.site.status !== "needs_auth") throw new Error("expected needs_auth");
  if (created.site.explorePath !== "/") {
    throw new Error("explore path mismatch");
  }

  const listed = await api("/api/sites");
  if (!listed.sites.some((s) => s.id === id)) throw new Error("list missing site");

  // Quick scan without auth should fail clearly
  const noAuth = await fetch(`${base}/api/sites/${id}/explore/quick`, { method: "POST" });
  if (noAuth.status !== 400) throw new Error("quick scan should 400 without auth");

  // Chat without CURSOR_API_KEY should fail clearly  
  const chatRes = await fetch(`${base}/api/sites/${id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "explore students" }),
  });
  if (chatRes.status !== 400) throw new Error("chat should 400 without auth/key");

  await api(`/api/sites/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({
      tools: [
        {
          name: "get_health_placeholder",
          description: "Placeholder tool for smoke test",
          method: "GET",
          url: "https://example.atlassian.net/",
          inputSchema: { type: "object", properties: {} },
          argBindings: {},
          headers: {},
          approved: true,
        },
      ],
    }),
  });

  const detail = await api(`/api/sites/${id}`);
  if (detail.site.tools.length !== 1) throw new Error("approve failed");

  const reg = await api(`/api/sites/${id}/register-cursor`, { method: "POST" });
  if (!reg.ok || !existsSync(mcpPath)) throw new Error("register-cursor failed");
  const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
  if (!mcp.mcpServers?.[reg.key]) throw new Error("mcp.json missing key");

  // Manual-select path: inject candidates then approve by id
  const siteBefore = await api(`/api/sites/${id}`);
  // Use second site for multi-server check
  const second = await api("/api/sites", {
    method: "POST",
    body: JSON.stringify({
      name: "Another Site",
      baseUrl: "https://example.com",
      explorePath: "/",
    }),
  });
  const multi = await api("/api/sites");
  if (multi.sites.length < 2) throw new Error("multi-server registry failed");

  await api(`/api/sites/${second.site.id}`, { method: "DELETE" });
  await api(`/api/sites/${id}`, { method: "DELETE" });
  if (!existsSync(mcpPath) || JSON.parse(readFileSync(mcpPath, "utf8")).mcpServers?.[reg.key]) {
    // delete removes cursor entry
    const after = existsSync(mcpPath)
      ? JSON.parse(readFileSync(mcpPath, "utf8"))
      : { mcpServers: {} };
    if (after.mcpServers?.[reg.key]) throw new Error("cursor key not removed on delete");
  }

  void siteBefore;
  console.log("SMOKE OK");
  process.exitCode = 0;
} catch (err) {
  console.error("SMOKE FAIL", err);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}
