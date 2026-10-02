import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

/** Demo/sample packs: core monorepo, auto_mcp_ai_sample_packs, or legacy paths. */
export const KNOWN_PACKS = ["jira"] as const;
export type KnownPack = (typeof KNOWN_PACKS)[number];

const PACK_NAME_RE = /^[a-z][a-z0-9_-]{0,32}$/;

export function adapterIdToPack(adapterId: string): string | null {
  if (adapterId === "jira") return "jira";
  return null;
}

export function assertPackName(pack: string): string {
  const p = pack.trim();
  if (!PACK_NAME_RE.test(p)) {
    throw new Error(
      `Invalid pack name \`${pack}\`. Use lowercase slug (e.g. jira, mysite).`,
    );
  }
  if (p === "node_modules" || p.includes("..")) {
    throw new Error(`Invalid pack name \`${pack}\``);
  }
  return p;
}

export function resolvePackRoot(repoRoot: string, pack: string): string {
  const name = assertPackName(pack);
  const inMonorepo = resolve(repoRoot, "packages", `site-adapter-${name}`);
  if (existsSync(inMonorepo)) {
    return resolve(inMonorepo, "src");
  }
  const samplePack = resolve(
    repoRoot,
    "..",
    "auto_mcp_ai_sample_packs",
    "packages",
    `site-adapter-${name}`,
    "src",
  );
  if (existsSync(samplePack)) return samplePack;
  return resolve(repoRoot, "packages", "site-adapters", "src", name);
}

/**
 * Resolve a relative path inside the pack source tree.
 * Rejects escapes outside the pack root.
 */
export function resolvePackFile(opts: {
  repoRoot: string;
  pack: string;
  relativePath: string;
}): { abs: string; relFromPack: string; packRoot: string } {
  const pack = assertPackName(opts.pack);
  const packRoot = resolvePackRoot(opts.repoRoot, pack);
  const rel = opts.relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!rel || rel.includes("\0")) {
    throw new Error("relativePath is required");
  }
  if (rel.split("/").some((part) => part === "..")) {
    throw new Error("Path must not contain '..'");
  }
  const abs = normalize(resolve(packRoot, rel));
  const relCheck = relative(packRoot, abs);
  if (relCheck.startsWith("..") || relCheck.includes(`..${sep}`)) {
    throw new Error(`Path escapes pack root: ${opts.relativePath}`);
  }
  return { abs, relFromPack: relCheck.split(sep).join("/"), packRoot };
}

export function listPackFiles(opts: {
  repoRoot: string;
  pack: string;
}): string[] {
  const pack = assertPackName(opts.pack);
  const packRoot = resolvePackRoot(opts.repoRoot, pack);
  try {
    if (!statSync(packRoot).isDirectory()) return [];
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  walk(packRoot, "");
  return out.sort();
}

export function readPackFile(opts: {
  repoRoot: string;
  pack: string;
  relativePath: string;
}): { path: string; content: string; bytes: number } {
  const { abs, relFromPack } = resolvePackFile(opts);
  const content = readFileSync(abs, "utf8");
  return { path: relFromPack, content, bytes: Buffer.byteLength(content) };
}

export function writePackFile(opts: {
  repoRoot: string;
  pack: string;
  relativePath: string;
  content: string;
  /** When false (default), refuse if the file already exists — use applyPackPatch instead. */
  overwrite?: boolean;
}): { path: string; bytes: number; created: boolean } {
  const { abs, relFromPack, packRoot } = resolvePackFile(opts);
  let exists = false;
  try {
    statSync(abs);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists && opts.overwrite !== true) {
    throw new Error(
      `File \`${relFromPack}\` already exists. Use apply_pack_patch for edits, or pass overwrite:true for intentional full rewrite.`,
    );
  }
  mkdirSync(dirname(abs), { recursive: true });
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(abs, opts.content, "utf8");
  return {
    path: relFromPack,
    bytes: Buffer.byteLength(opts.content),
    created: !exists,
  };
}

/**
 * Exact search-replace inside a pack file (like StrReplace).
 * oldString must appear exactly once unless replaceAll is true.
 */
export function applyPackPatch(opts: {
  repoRoot: string;
  pack: string;
  relativePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}): {
  path: string;
  replacements: number;
  bytesBefore: number;
  bytesAfter: number;
} {
  if (opts.oldString === "") {
    throw new Error("oldString must not be empty");
  }
  if (opts.oldString === opts.newString) {
    throw new Error("oldString and newString are identical — nothing to change");
  }
  const { abs, relFromPack } = resolvePackFile(opts);
  if (!existsSync(abs)) {
    throw new Error(
      `File \`${relFromPack}\` does not exist. Use write_pack_file to create it.`,
    );
  }
  const before = readFileSync(abs, "utf8");
  const occurrences = before.split(opts.oldString).length - 1;
  if (occurrences === 0) {
    throw new Error(
      `oldString not found in \`${relFromPack}\`. Re-read the file and use an exact unique snippet.`,
    );
  }
  if (occurrences > 1 && opts.replaceAll !== true) {
    throw new Error(
      `oldString matched ${occurrences} times in \`${relFromPack}\`. Narrow the snippet or pass replaceAll:true.`,
    );
  }
  const after =
    opts.replaceAll === true
      ? before.split(opts.oldString).join(opts.newString)
      : before.replace(opts.oldString, opts.newString);
  writeFileSync(abs, after, "utf8");
  return {
    path: relFromPack,
    replacements: opts.replaceAll === true ? occurrences : 1,
    bytesBefore: Buffer.byteLength(before),
    bytesAfter: Buffer.byteLength(after),
  };
}

export type PackTestResult = {
  ok: boolean;
  pack: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
};

/** Build + run node:test for packages/site-adapter-<pack>/ (+ pipeline tests for jira seeds). */
export async function runPackTests(opts: {
  repoRoot: string;
  pack: string;
}): Promise<PackTestResult> {
  const pack = assertPackName(opts.pack);
  const packPkgMonorepo = join(opts.repoRoot, "packages", `site-adapter-${pack}`);
  const packPkgSample = join(
    opts.repoRoot,
    "..",
    "auto_mcp_ai_sample_packs",
    "packages",
    `site-adapter-${pack}`,
  );
  const siteAdapters = join(opts.repoRoot, "packages", "site-adapters");
  const packCwd = existsSync(join(packPkgMonorepo, "package.json"))
    ? packPkgMonorepo
    : existsSync(join(packPkgSample, "package.json"))
      ? packPkgSample
      : siteAdapters;

  const command = `pnpm run test`;
  return new Promise((resolvePromise) => {
    const child = spawn("pnpm", ["run", "test"], {
      cwd: packCwd,
      env: process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (buildCode) => {
      if (buildCode !== 0) {
        resolvePromise({
          ok: false,
          pack,
          exitCode: buildCode,
          stdout: stdout.slice(-8000),
          stderr: stderr.slice(-8000),
          command: "pnpm run test",
        });
        return;
      }
      resolvePromise({
        ok: true,
        pack,
        exitCode: 0,
        stdout: stdout.slice(-12000),
        stderr: stderr.slice(-8000),
        command,
      });
    });
  });
}
