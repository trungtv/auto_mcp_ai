import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  assertProfileAvailable,
  acquireProfileLock,
  releaseProfileLock,
} from "./profile-lock.js";

test("assertProfileAvailable passes when no lock file", () => {
  const dir = join(tmpdir(), `auto-mcp-lock-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  assertProfileAvailable(dir);
  rmSync(dir, { recursive: true, force: true });
});

test("assertProfileAvailable passes when this process holds the lock", () => {
  const dir = join(tmpdir(), `auto-mcp-lock-${Date.now()}-2`);
  mkdirSync(dir, { recursive: true });
  acquireProfileLock({ profileDir: dir, siteId: "site-1", kind: "explore" });
  assertProfileAvailable(dir);
  releaseProfileLock(dir);
  rmSync(dir, { recursive: true, force: true });
});

test("assertProfileAvailable throws when another live pid holds lock", () => {
  const dir = join(tmpdir(), `auto-mcp-lock-${Date.now()}-3`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, ".auto-mcp-profile.lock"),
    `${JSON.stringify({
      pid: 1,
      kind: "explore",
      siteId: "other",
      at: new Date().toISOString(),
    })}\n`,
  );
  assert.throws(() => assertProfileAvailable(dir), /Profile đang bị khóa/);
  rmSync(dir, { recursive: true, force: true });
});
