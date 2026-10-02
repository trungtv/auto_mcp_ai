import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Registry } from "@auto-mcp/registry";
import { Vault } from "@auto-mcp/vault";
import type { ApiCandidate } from "@auto-mcp/shared";
import {
  applyEndpointIrTests,
  compileEndpointsOp,
  upsertCapabilityOp,
} from "./site-ops.js";

describe("compileEndpointsOp", () => {
  it("preview without confirm returns IR names and does not write tools", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mcp-ir-"));
    try {
      const registry = new Registry(dir);
      const vault = new Vault(dir, "test-master-key-16");
      const site = registry.create(
        { baseUrl: "https://ex.com/", name: "ex" },
        join(dir, "profile"),
      );
      const candidate: ApiCandidate = {
        id: "c1",
        method: "GET",
        url: "https://ex.com/api/items?q=hi",
        status: 200,
        requestHeaders: {},
        contentType: "application/json",
        responseBodySample: { items: [] },
        resourceHint: "fetch",
      };
      registry.update(site.id, { candidates: [candidate] });
      const ctx = {
        registry,
        vault,
        dataDir: dir,
        masterKey: "test-master-key-16",
        runtimeEntry: "/tmp/runtime.js",
      };
      const preview = compileEndpointsOp(ctx, site.id, {
        candidateIds: ["c1"],
        confirm: false,
      });
      assert.equal(preview.preview, true);
      assert.ok(Array.isArray(preview.endpointIr));
      assert.equal((preview.willCreateToolNames as string[]).length, 1);
      assert.equal(registry.get(site.id)?.tools.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyEndpointIrTests", () => {
  it("preview without confirm does not write lastContract", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mcp-test-"));
    try {
      const registry = new Registry(dir);
      const vault = new Vault(dir, "test-master-key-16");
      const site = registry.create(
        { baseUrl: "https://ex.com/", name: "ex" },
        join(dir, "profile"),
      );
      const candidate: ApiCandidate = {
        id: "c1",
        method: "GET",
        url: "https://ex.com/api/items?q=hi",
        status: 200,
        requestHeaders: {},
        contentType: "application/json",
        responseBodySample: { items: [] },
        resourceHint: "fetch",
      };
      registry.update(site.id, { candidates: [candidate] });
      const ctx = {
        registry,
        vault,
        dataDir: dir,
        masterKey: "test-master-key-16",
        runtimeEntry: "/tmp/runtime.js",
      };
      compileEndpointsOp(ctx, site.id, {
        candidateIds: ["c1"],
        confirm: true,
      });
      const compiled = registry.get(site.id)!;
      const irId = compiled.endpointIr[0]?.id;
      assert.ok(irId);
      const result = await applyEndpointIrTests({
        site: compiled,
        endpointIds: [irId],
        confirm: false,
        replay: async () => ({ status: 200, body: { items: [] } }),
      });
      assert.equal(result.preview, true);
      assert.equal(registry.get(site.id)?.endpointIr[0]?.lastContract, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("upsertCapabilityOp endpointIrId", () => {
  it("throws when endpointIrId compiledPrimitive mismatches bind.primitive", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mcp-upsert-"));
    try {
      const registry = new Registry(dir);
      const vault = new Vault(dir, "test-master-key-16");
      const site = registry.create(
        { baseUrl: "https://ex.com/", name: "ex" },
        join(dir, "profile"),
      );
      const candidate: ApiCandidate = {
        id: "c1",
        method: "GET",
        url: "https://ex.com/api/items?q=hi",
        status: 200,
        requestHeaders: {},
        contentType: "application/json",
        responseBodySample: { items: [] },
        resourceHint: "fetch",
      };
      registry.update(site.id, { candidates: [candidate] });
      const ctx = {
        registry,
        vault,
        dataDir: dir,
        masterKey: "test-master-key-16",
        runtimeEntry: "/tmp/runtime.js",
      };
      compileEndpointsOp(ctx, site.id, {
        candidateIds: ["c1"],
        confirm: true,
      });
      const compiled = registry.get(site.id)!;
      const endpoint = compiled.endpointIr[0];
      assert.ok(endpoint?.compiledPrimitive);
      assert.throws(
        () =>
          upsertCapabilityOp(ctx, site.id, {
            confirm: true,
            name: "list_items",
            description: "list",
            bind: {
              kind: "primitive",
              primitive: "wrong_name",
              endpointIrId: endpoint.id,
            },
          }),
        /compiledPrimitive/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when endpointIrId is not in endpointIrIds", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mcp-upsert-ids-"));
    try {
      const registry = new Registry(dir);
      const vault = new Vault(dir, "test-master-key-16");
      const site = registry.create(
        { baseUrl: "https://ex.com/", name: "ex" },
        join(dir, "profile"),
      );
      const a: ApiCandidate = {
        id: "c1",
        method: "GET",
        url: "https://ex.com/api/v1/items",
        status: 200,
        requestHeaders: {},
        contentType: "application/json",
        responseBodySample: { items: [] },
        resourceHint: "fetch",
      };
      const b: ApiCandidate = {
        id: "c2",
        method: "GET",
        url: "https://ex.com/api/v2/items",
        status: 200,
        requestHeaders: {},
        contentType: "application/json",
        responseBodySample: { items: [] },
        resourceHint: "fetch",
      };
      registry.update(site.id, { candidates: [a, b] });
      const ctx = {
        registry,
        vault,
        dataDir: dir,
        masterKey: "test-master-key-16",
        runtimeEntry: "/tmp/runtime.js",
      };
      compileEndpointsOp(ctx, site.id, {
        candidateIds: ["c1", "c2"],
        confirm: true,
      });
      const compiled = registry.get(site.id)!;
      const irA = compiled.endpointIr[0];
      const irB = compiled.endpointIr[1];
      assert.ok(irA && irB);
      assert.throws(
        () =>
          upsertCapabilityOp(ctx, site.id, {
            confirm: true,
            name: "list_items",
            description: "list",
            bind: {
              kind: "primitive",
              primitive: irA.compiledPrimitive!,
              endpointIrId: irB.id,
              endpointIrIds: [irA.id],
            },
          }),
        /must be included in endpointIrIds/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts endpointIrIds when bind.primitive is one compiled name", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mcp-upsert-1n-"));
    try {
      const registry = new Registry(dir);
      const vault = new Vault(dir, "test-master-key-16");
      const site = registry.create(
        { baseUrl: "https://ex.com/", name: "ex" },
        join(dir, "profile"),
      );
      const a: ApiCandidate = {
        id: "c1",
        method: "GET",
        url: "https://ex.com/api/v1/items",
        status: 200,
        requestHeaders: {},
        contentType: "application/json",
        responseBodySample: { items: [] },
        resourceHint: "fetch",
      };
      const b: ApiCandidate = {
        id: "c2",
        method: "GET",
        url: "https://ex.com/api/v2/items",
        status: 200,
        requestHeaders: {},
        contentType: "application/json",
        responseBodySample: { items: [] },
        resourceHint: "fetch",
      };
      registry.update(site.id, { candidates: [a, b] });
      const ctx = {
        registry,
        vault,
        dataDir: dir,
        masterKey: "test-master-key-16",
        runtimeEntry: "/tmp/runtime.js",
      };
      compileEndpointsOp(ctx, site.id, {
        candidateIds: ["c1", "c2"],
        confirm: true,
      });
      const compiled = registry.get(site.id)!;
      const ids = compiled.endpointIr.map((e) => e.id);
      const prim = compiled.endpointIr[0]?.compiledPrimitive;
      assert.equal(ids.length, 2);
      assert.ok(prim);
      const result = upsertCapabilityOp(ctx, site.id, {
        confirm: true,
        name: "list_items",
        description: "list",
        bind: {
          kind: "primitive",
          primitive: prim,
          endpointIrIds: ids,
        },
      });
      assert.equal(result.preview, false);
      const stored = registry.get(site.id)?.capabilities ?? [];
      assert.equal(stored[0]?.bind.kind, "primitive");
      if (stored[0]?.bind.kind === "primitive") {
        assert.deepEqual(stored[0].bind.endpointIrIds, ids);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
