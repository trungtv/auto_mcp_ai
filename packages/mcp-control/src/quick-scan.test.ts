import assert from "node:assert/strict";
import { test } from "node:test";
import { quickScanOp } from "./quick-scan.js";
import { Registry } from "@auto-mcp/registry";
import { Vault } from "@auto-mcp/vault";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("quickScanOp throws without vault auth", async () => {
  const dataDir = join(tmpdir(), `quick-scan-${Date.now()}`);
  mkdirSync(dataDir, { recursive: true });
  const registry = new Registry(dataDir);
  const vault = new Vault(dataDir, "test-master-key-32-chars-min!!");
  const site = registry.create(
    { name: "t", baseUrl: "https://example.com/" },
    join(dataDir, "profiles", "_pending"),
  );
  const profileDir = registry.profileDirFor(dataDir, site.id, site.baseUrl);
  const updated = registry.update(site.id, { profileDir });
  await assert.rejects(
    () => quickScanOp({ registry, vault }, updated, { reuseSession: true }),
    /No auth session/,
  );
  rmSync(dataDir, { recursive: true, force: true });
});
