import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EndpointIr, ToolDef } from "@auto-mcp/shared";
import {
  testEndpointContract,
  testEndpointMutation,
} from "./contract.js";

function tool(partial: Partial<ToolDef> & Pick<ToolDef, "name">): ToolDef {
  return {
    description: partial.name,
    method: "GET",
    url: "https://ex.com/api/search",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    annotations: {},
    captureContext: {},
    argBindings: { q: { in: "query", key: "q" } },
    headers: {},
    approved: true,
    ...partial,
  };
}

function searchIr(overrides: Partial<EndpointIr> = {}): EndpointIr {
  return {
    id: "e1",
    key: "GET https://ex.com/api/search",
    method: "GET",
    urlTemplate: "https://ex.com/api/search",
    kind: "data_api",
    params: [
      { name: "q", in: "query", samples: ["foo", "bar"], inferredType: "string" },
    ],
    responseKeys: ["items", "total"],
    evidenceActionIds: [],
    candidateIds: ["c1"],
    suggestedName: "search",
    compiledPrimitive: "get_search",
    ...overrides,
  };
}

describe("testEndpointContract", () => {
  it("passes when JSON keys overlap", async () => {
    const r = await testEndpointContract({
      ir: searchIr(),
      tool: tool({ name: "get_search" }),
      replay: async () => ({ status: 200, body: { items: [], total: 1, extra: true } }),
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.matchedKeys, ["items", "total"]);
  });

  it("fails when responseKeys is empty (incomplete_schema)", async () => {
    const r = await testEndpointContract({
      ir: searchIr({ responseKeys: [] }),
      tool: tool({ name: "get_search" }),
      replay: async () => ({ status: 200, body: { items: [] } }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.note, "incomplete_schema");
  });
});

describe("testEndpointMutation", () => {
  it("replays the second sample for query param q", async () => {
    let seen: Record<string, unknown> | undefined;
    const r = await testEndpointMutation({
      ir: searchIr(),
      tool: tool({ name: "get_search" }),
      replay: async (_t, args) => {
        seen = args;
        return { status: 200, body: { items: [], total: 0 } };
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.param, "q");
    assert.equal(r.from, "foo");
    assert.equal(r.to, "bar");
    assert.equal(seen?.q, "bar");
  });

  it("throws on frozen/GWT when mutate is requested", async () => {
    await assert.rejects(
      () =>
        testEndpointMutation({
          ir: searchIr(),
          tool: tool({
            name: "get_courses",
            method: "POST",
            bodyTemplate: "7|0|1|com.x.DataService|getCourses|",
            captureContext: { frozen: true, rpcMethod: "getCourses" },
          }),
          replay: async () => ({ status: 200, body: "//OK[1]" }),
        }),
      /not supported for frozen\/GWT/,
    );
  });
});
