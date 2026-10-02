import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ProfileLockKind = "login" | "explore" | "replay";

type LockPayload = {
  pid: number;
  kind: ProfileLockKind;
  siteId: string;
  at: string;
};

const inProcess = new Map<string, LockPayload>();

function lockFile(profileDir: string): string {
  return join(profileDir, ".auto-mcp-profile.lock");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireProfileLock(opts: {
  profileDir: string;
  siteId: string;
  kind: ProfileLockKind;
}): void {
  mkdirSync(opts.profileDir, { recursive: true });
  const local = inProcess.get(opts.profileDir);
  if (local && (local.kind !== opts.kind || local.siteId !== opts.siteId)) {
    throw new Error(
      `Profile đang dùng bởi ${local.kind} — đóng ${local.kind} trước khi ${opts.kind}.`,
    );
  }
  if (local && local.kind === opts.kind && local.siteId === opts.siteId) {
    return;
  }
  const path = lockFile(opts.profileDir);
  if (existsSync(path)) {
    try {
      const prev = JSON.parse(readFileSync(path, "utf8")) as LockPayload;
      if (prev.pid !== process.pid && pidAlive(prev.pid)) {
        throw new Error(
          `Profile đang dùng bởi ${prev.kind} (pid ${prev.pid}) — đóng ${prev.kind}/login/explore trước.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Profile đang dùng")) {
        throw err;
      }
    }
  }
  const payload: LockPayload = {
    pid: process.pid,
    kind: opts.kind,
    siteId: opts.siteId,
    at: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload)}\n`);
  inProcess.set(opts.profileDir, payload);
}

export function releaseProfileLock(profileDir: string): void {
  inProcess.delete(profileDir);
  const path = lockFile(profileDir);
  try {
    if (!existsSync(path)) return;
    const prev = JSON.parse(readFileSync(path, "utf8")) as LockPayload;
    if (prev.pid !== process.pid) return;
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}
