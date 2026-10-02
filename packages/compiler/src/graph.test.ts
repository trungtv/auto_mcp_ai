import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EndpointIr } from "@auto-mcp/shared";
import { buildCapabilityGraph, mergeTestEvidence } from "./graph.js";

function ir(partial: Partial<EndpointIr> & Pick<EndpointIr, "id" | "suggestedName">): EndpointIr {
  return {
    key: `GET https://ex.com/api/${partial.suggestedName}`,
    method: "GET",
    urlTemplate: `https://ex.com/api/${partial.suggestedName}`,
    kind: "data_api",
    params: [],
    responseKeys: ["items"],
    evidenceActionIds: [],
    candidateIds: [],
    ...partial,
  };
}

describe("buildCapabilityGraph", () => {
  it("links compiled IR + cap bind primitive into ir_compiled, cap_bind, cap_ir", () => {
    const endpoint = ir({
      id: "e1",
      suggestedName: "search",
      compiledPrimitive: "get_search",
    });
    const g = buildCapabilityGraph({
      endpointIr: [endpoint],
      primitives: [{ name: "get_search", approved: true }],
      capabilities: [
        {
          name: "search_issues",
          bind: { kind: "primitive", primitive: "get_search" },
        },
      ],
    });
    const kinds = g.nodes.map((n) => n.kind).sort();
    assert.deepEqual(kinds, ["capability", "ir", "primitive"]);
    assert.ok(
      g.edges.some(
        (e) => e.kind === "ir_compiled" && e.from === "ir:e1" && e.to === "prim:get_search",
      ),
    );
    assert.ok(
      g.edges.some(
        (e) =>
          e.kind === "cap_bind" &&
          e.from === "cap:search_issues" &&
          e.to === "prim:get_search",
      ),
    );
    assert.ok(
      g.edges.some(
        (e) =>
          e.kind === "cap_ir" &&
          e.from === "cap:search_issues" &&
          e.to === "ir:e1",
      ),
    );
  });

  it("still emits cap_bind for bind.primitive only", () => {
    const g = buildCapabilityGraph({
      endpointIr: [],
      primitives: [{ name: "get_classes", approved: true }],
      capabilities: [
        {
          name: "list_teaching_classes",
          bind: { kind: "primitive", primitive: "get_classes" },
        },
      ],
    });
    assert.ok(
      g.edges.some(
        (e) =>
          e.kind === "cap_bind" &&
          e.from === "cap:list_teaching_classes" &&
          e.to === "prim:get_classes",
      ),
    );
    assert.equal(g.edges.filter((e) => e.kind === "cap_ir").length, 0);
  });

  it("emits cap_ir for every id in endpointIrIds", () => {
    const a = ir({ id: "e1", suggestedName: "search_v1", compiledPrimitive: "get_v1" });
    const b = ir({ id: "e2", suggestedName: "search_v2", compiledPrimitive: "get_v2" });
    const g = buildCapabilityGraph({
      endpointIr: [a, b],
      primitives: [
        { name: "get_v1", approved: true },
        { name: "get_v2", approved: true },
      ],
      capabilities: [
        {
          name: "search",
          bind: {
            kind: "primitive",
            primitive: "get_v1",
            endpointIrIds: ["e1", "e2"],
          },
        },
      ],
    });
    const irEdges = g.edges.filter(
      (e) => e.kind === "cap_ir" && e.from === "cap:search",
    );
    assert.equal(irEdges.length, 2);
    assert.ok(irEdges.some((e) => e.to === "ir:e1"));
    assert.ok(irEdges.some((e) => e.to === "ir:e2"));
    assert.ok(
      g.edges.some(
        (e) =>
          e.kind === "cap_bind" && e.from === "cap:search" && e.to === "prim:get_v2",
      ),
    );
  });
});

describe("mergeTestEvidence", () => {
  it("does not mutate source IR when caller keeps the original array", () => {
    const endpoint = ir({ id: "e1", suggestedName: "search" });
    const next = mergeTestEvidence([endpoint], [
      {
        endpointId: "e1",
        lastContract: {
          at: "t",
          ok: true,
          status: 200,
          matchedKeys: ["items"],
          missingKeys: [],
        },
      },
    ]);
    assert.equal(endpoint.lastContract, undefined);
    assert.equal(next[0]?.lastContract?.ok, true);
  });
});
