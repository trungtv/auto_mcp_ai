import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = findRepoRoot(here);

config({ path: resolve(ROOT_DIR, ".env") });

export function resolveDataDir(raw?: string): string {
  const value = (raw ?? process.env.DATA_DIR ?? ".data").trim() || ".data";
  if (isAbsolute(value)) return value;
  return resolve(ROOT_DIR, value);
}
