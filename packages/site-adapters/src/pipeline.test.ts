import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveArgTemplates } from "./pipeline.js";
import { defToCapability } from "./bound.js";
import { genericReplayAdapter } from "./generic.js";
import type {
  CapabilityDef,
  EndpointIr,
  McpSite,
  ToolDef,
} from "@auto-mcp/shared";

describe("resolveArgTemplates", () => {
  it("resolves input and steps paths", () => {
    const out = resolveArgTemplates(
      {
        issueKey: "{{input.issueKey}}",
        fromStep: "{{steps.0.issue.key}}",
        literal: "fixed",
      },
      {
        input: { issueKey: "DATA-1" },
        steps: [{ issue: { key: "DATA-1" } }],
      },
    );
    assert.equal(out.issueKey, "DATA-1");
    assert.equal(out.fromStep, "DATA-1");
    assert.equal(out.literal, "fixed");
  });

  it("throws when template path missing", () => {
    assert.throws(
      () =>
        resolveArgTemplates(
          { x: "{{input.missing}}" },
          { input: {}, steps: [] },
        ),
      /undefined/,
    );
  });
});

describe("defToCapability 1:N endpointIrIds", () => {
  function prim(name: string): ToolDef {
    return {
      name,
      description: name,
      method: "GET",
      url: `https://ex.com/api/${name}`,
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      annotations: {},
      captureContext: {},
      argBindings: {},
      headers: {},
      approved: true,
    };
  }

  function ir(
    id: string,
    compiled: string,
    at: string,
    ok = true,
  ): EndpointIr {
    return {
      id,
      key: `GET https://ex.com/api/${id}`,
      method: "GET",
      urlTemplate: `https://ex.com/api/${id}`,
      kind: "data_api",
      params: [],
      responseKeys: ["items", "total"],
      evidenceActionIds: [],
      candidateIds: [],
      suggestedName: id,
      compiledPrimitive: compiled,
      lastContract: {
        at,
        ok,
        status: 200,
        matchedKeys: ["items"],
        missingKeys: [],
      },
    };
  }

  const baseSite: McpSite = {
    id: "s1",
    name: "ex",
    baseUrl: "https://ex.com/",
    explorePath: "/",
    status: "ready",
    cursorMcpKey: "ex",
    profileDir: "/tmp",
    tools: [],
    candidates: [],
    proposedTools: [],
    capabilities: [],
    chatAgentId: null,
    chatMessages: [],
    exploreRounds: [],
    exploreFocus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAuthAt: null,
    lastExploreAt: null,
    replayMode: "http",
    observedActions: [],
    endpointIr: [],
  };

  it("executes the newest lastContract.ok compiled primitive", async () => {
    const v1 = prim("get_v1");
    const v2 = prim("get_v2");
    const catalog = [
      ir("e1", "get_v1", "2026-01-01T00:00:00Z"),
      ir("e2", "get_v2", "2026-08-01T00:00:00Z"),
    ];
    const def: CapabilityDef = {
      name: "list_items",
      description: "list",
      inputSchema: { type: "object", properties: {} },
      bind: {
        kind: "primitive",
        primitive: "get_v1",
        endpointIrIds: ["e1", "e2"],
      },
      enabled: true,
      updatedAt: new Date().toISOString(),
    };
    const cap = defToCapability(def, genericReplayAdapter, catalog);
    assert.ok(cap);
    const props = (cap.outputSchema as { properties?: Record<string, unknown> })
      ?.properties;
    assert.ok(props?.items);
    let called = "";
    const result = await cap.execute(
      {
        site: { ...baseSite, endpointIr: catalog, tools: [v1, v2] },
        auth: {
          cookies: [],
          authHeaders: {},
          authHeadersByOrigin: {},
          capturedAt: new Date().toISOString(),
          origin: "https://ex.com",
        },
        primitives: [v1, v2],
        replay: async (tool) => {
          called = tool.name;
          return { status: 200, body: { items: [] } };
        },
      },
      {},
    );
    assert.equal(called, "get_v2");
    assert.equal(result.isError, undefined);
  });

  it("throws when no bound IR has lastContract.ok", async () => {
    const v1 = prim("get_v1");
    const catalog = [ir("e1", "get_v1", "t0", false)];
    const def: CapabilityDef = {
      name: "list_items",
      description: "list",
      inputSchema: { type: "object", properties: {} },
      bind: {
        kind: "primitive",
        primitive: "get_v1",
        endpointIrIds: ["e1"],
      },
      enabled: true,
      updatedAt: new Date().toISOString(),
    };
    const cap = defToCapability(def, genericReplayAdapter, catalog);
    assert.ok(cap);
    await assert.rejects(
      async () => {
        await cap.execute(
          {
            site: { ...baseSite, endpointIr: catalog, tools: [v1] },
            auth: {
              cookies: [],
              authHeaders: {},
              authHeadersByOrigin: {},
              capturedAt: new Date().toISOString(),
              origin: "https://ex.com",
            },
            primitives: [v1],
            replay: async () => ({ status: 200, body: {} }),
          },
          {},
        );
      },
      /No contracted endpoint/,
    );
  });
});
