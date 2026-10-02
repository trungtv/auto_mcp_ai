import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AuthSnapshot } from "@auto-mcp/shared";
import { Vault } from "./index.js";

function snap(at: string): AuthSnapshot {
  return {
    cookies: [{ name: "session", value: "v", domain: "example.com", path: "/" }],
    authHeaders: {},
    authHeadersByOrigin: {},
    capturedAt: at,
    origin: "https://example.com",
  };
}

describe("Vault cross-process sync", () => {
  it("has/get see writes from another Vault instance on the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "vault-sync-"));
    try {
      const a = new Vault(dir, "test-master-key-16");
      const b = new Vault(dir, "test-master-key-16");
      assert.equal(a.has("site-1"), false);

      b.set("site-1", snap("2026-08-14T04:10:00.000Z"));

      assert.equal(a.has("site-1"), true);
      assert.equal(a.get("site-1")?.capturedAt, "2026-08-14T04:10:00.000Z");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("set merges with disk instead of overwriting peer keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "vault-merge-"));
    try {
      const a = new Vault(dir, "test-master-key-16");
      const b = new Vault(dir, "test-master-key-16");

      a.set("site-a", snap("t-a"));
      b.set("site-b", snap("t-b"));

      assert.equal(a.has("site-a"), true);
      assert.equal(a.has("site-b"), true);
      assert.equal(b.has("site-a"), true);
      assert.equal(b.has("site-b"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
