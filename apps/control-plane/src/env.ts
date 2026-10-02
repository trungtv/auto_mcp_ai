import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      existsSync(join(dir, ".env"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = findRepoRoot(here);

config({ path: resolve(ROOT_DIR, ".env") });

/** Relative DATA_DIR is always resolved from repo root (never process.cwd()). */
export function resolveDataDir(raw?: string): string {
  const value = (raw ?? ".data").trim() || ".data";
  if (isAbsolute(value)) return value;
  return resolve(ROOT_DIR, value);
}

const WEAK_MASTER_KEYS = new Set([
  "dev-only-change-me-16",
  "change-me-to-a-long-random-secret",
]);

export function getEnv() {
  const dataDir = resolveDataDir(process.env.DATA_DIR);
  const masterKey = process.env.AUTO_MCP_MASTER_KEY ?? "dev-only-change-me-16";
  const port = Number(process.env.PORT ?? 3847);
  const host = process.env.HOST ?? "127.0.0.1";
  const cursorApiKey = process.env.CURSOR_API_KEY ?? "";
  const controlToken = (process.env.AUTO_MCP_CONTROL_TOKEN ?? "").trim();
  const allowInsecureDev =
    process.env.AUTO_MCP_ALLOW_INSECURE_DEV === "1" ||
    process.env.AUTO_MCP_ALLOW_INSECURE_DEV === "true";
  return {
    dataDir,
    masterKey,
    port,
    host,
    cursorApiKey,
    controlToken,
    allowInsecureDev,
    root: ROOT_DIR,
  };
}

/** Fail closed unless AUTO_MCP_ALLOW_INSECURE_DEV=1. */
export function assertSecureEnv(env: ReturnType<typeof getEnv>): void {
  const loopback =
    env.host === "127.0.0.1" ||
    env.host === "localhost" ||
    env.host === "::1";
  if (!loopback && !env.allowInsecureDev) {
    throw new Error(
      `Refusing to bind HOST=${env.host}. Use 127.0.0.1 or set AUTO_MCP_ALLOW_INSECURE_DEV=1`,
    );
  }
  if (
    (WEAK_MASTER_KEYS.has(env.masterKey) || env.masterKey.length < 16) &&
    !env.allowInsecureDev
  ) {
    throw new Error(
      "Refusing weak/default AUTO_MCP_MASTER_KEY. Set a strong key (≥16 chars) or AUTO_MCP_ALLOW_INSECURE_DEV=1",
    );
  }
  if (!env.controlToken && !env.allowInsecureDev) {
    throw new Error(
      "AUTO_MCP_CONTROL_TOKEN is required (Bearer token for /api/*). Or set AUTO_MCP_ALLOW_INSECURE_DEV=1 for local-only POC",
    );
  }
}
