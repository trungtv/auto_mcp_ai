import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidateToTool } from "@auto-mcp/mcp-generator";
import {
  selectContractedEndpoint,
  type ApiCandidate,
  type EndpointIr,
} from "@auto-mcp/shared";
import {
  compileEndpoint,
  planCompile,
  recordObservation,
  rebuildIr,
} from "./compiler.js";

function jsonGet(id: string, url: string): ApiCandidate {
  return {
    id,
    method: "GET",
    url,
    status: 200,
    requestHeaders: {},
    contentType: "application/json",
    responseBodySample: { items: [], total: 0 },
    resourceHint: "fetch",
  };
}

describe("rebuildIr", () => {
  it("clusters 3 URLs with the same path and different query into 1 IR, merging q/page", () => {
    const c1 = jsonGet("1", "https://ex.com/api/search?q=foo");
    const c2 = jsonGet("2", "https://ex.com/api/search?q=bar&page=1");
    const c3 = jsonGet("3", "https://ex.com/api/search?page=2");
    const actions = [c1, c2, c3].map((c) => recordObservation({ candidate: c }));
    const ir = rebuildIr(actions, [c1, c2, c3]);
    assert.equal(ir.length, 1);
    assert.equal(ir[0]?.kind, "data_api");
    assert.equal(ir[0]?.urlTemplate, "https://ex.com/api/search");
    const names = (ir[0]?.params ?? []).map((p) => p.name).sort();
    assert.deepEqual(names, ["page", "q"]);
    assert.ok(ir[0]?.params.find((p) => p.name === "q")?.samples.includes("foo"));
    assert.ok(ir[0]?.params.find((p) => p.name === "page")?.samples.includes("1"));
    assert.equal(ir[0]?.candidateIds.length, 3);
  });

  it("does not merge GWT calls that share a path but differ by #rpcMethod", () => {
    const g1: ApiCandidate = {
      id: "g1",
      method: "POST",
      url: "https://app.example.edu/soicteducationteacher/rpc",
      status: 200,
      requestHeaders: {},
      contentType: "text/x-gwt-rpc; charset=utf-8",
      requestBodySample:
        "7|0|4|https://app.example.edu/|abc|com.example.DataService|getCourses|1|2|3|4|",
      rpcService: "com.example.DataService",
      rpcMethod: "getCourses",
      resourceHint: "xhr",
    };
    const g2: ApiCandidate = {
      ...g1,
      id: "g2",
      requestBodySample:
        "7|0|4|https://app.example.edu/|abc|com.example.DataService|getClasses|1|2|3|4|",
      rpcMethod: "getClasses",
    };
    const ir = rebuildIr(
      [recordObservation({ candidate: g1 }), recordObservation({ candidate: g2 })],
      [g1, g2],
    );
    assert.equal(ir.length, 2);
    const names = ir.map((e) => e.suggestedName).sort();
    assert.deepEqual(names, ["get_classes", "get_courses"]);
    assert.ok(ir.every((e) => e.key.includes("#")));
  });
});

describe("compileEndpoint", () => {
  it("produces the same query bindings as candidateToTool for a JSON GET", () => {
    const c = jsonGet("c1", "https://ex.com/api/items?q=hi&limit=10");
    const ir = rebuildIr([recordObservation({ candidate: c })], [c])[0];
    assert.ok(ir);
    const fromIr = compileEndpoint(ir, c);
    const fromCand = candidateToTool(c);
    assert.deepEqual(fromIr.argBindings, fromCand.argBindings);
    assert.equal(fromIr.method, fromCand.method);
    assert.equal(fromIr.url, fromCand.url);
  });

  it("sets outputSchema properties from IR.responseKeys for JSON", () => {
    const c = jsonGet("c1", "https://ex.com/api/items?q=hi");
    const ir = rebuildIr([recordObservation({ candidate: c })], [c])[0];
    assert.ok(ir);
    const tool = compileEndpoint(ir, c);
    const props = (tool.outputSchema as { properties?: Record<string, unknown> })
      ?.properties;
    assert.ok(props?.items);
    assert.ok(props?.total);
  });

  it("does not infer outputSchema from responseKeys for GWT", () => {
    const g: ApiCandidate = {
      id: "g1",
      method: "POST",
      url: "https://app.example.edu/soicteducationteacher/rpc",
      status: 200,
      requestHeaders: {},
      contentType: "text/x-gwt-rpc; charset=utf-8",
      requestBodySample:
        "7|0|4|https://app.example.edu/|abc|com.example.DataService|getCourses|1|2|3|4|",
      rpcService: "com.example.DataService",
      rpcMethod: "getCourses",
      resourceHint: "xhr",
    };
    const ir = rebuildIr([recordObservation({ candidate: g })], [g])[0];
    assert.ok(ir);
    const tool = compileEndpoint(ir, g);
    const props = (tool.outputSchema as { properties?: Record<string, unknown> })
      ?.properties;
    assert.equal(props?.items, undefined);
  });
});

describe("selectContractedEndpoint", () => {
  function endpoint(
    id: string,
    opts: {
      compiled?: string;
      ok?: boolean;
      at?: string;
    },
  ): EndpointIr {
    return {
      id,
      key: `GET https://ex.com/${id}`,
      method: "GET",
      urlTemplate: `https://ex.com/${id}`,
      kind: "data_api",
      params: [],
      responseKeys: ["items"],
      evidenceActionIds: [],
      candidateIds: [],
      suggestedName: id,
      ...(opts.compiled ? { compiledPrimitive: opts.compiled } : {}),
      ...(opts.ok !== undefined
        ? {
            lastContract: {
              at: opts.at ?? "t0",
              ok: opts.ok,
              status: 200,
              matchedKeys: ["items"],
              missingKeys: [],
            },
          }
        : {}),
    };
  }

  it("picks the newest lastContract.ok compiled IR", () => {
    const selected = selectContractedEndpoint(
      [
        endpoint("old", { compiled: "get_v1", ok: true, at: "2026-01-01T00:00:00Z" }),
        endpoint("new", { compiled: "get_v2", ok: true, at: "2026-08-01T00:00:00Z" }),
        endpoint("fail", { compiled: "get_v3", ok: false, at: "2026-09-01T00:00:00Z" }),
      ],
      ["old", "new", "fail"],
    );
    assert.equal(selected.id, "new");
    assert.equal(selected.compiledPrimitive, "get_v2");
  });

  it("throws when no IR has lastContract.ok", () => {
    assert.throws(
      () =>
        selectContractedEndpoint(
          [
            endpoint("a", { compiled: "get_a", ok: false }),
            endpoint("b", { compiled: "get_b" }),
          ],
          ["a", "b"],
        ),
      /No contracted endpoint/,
    );
  });
});

describe("planCompile preview", () => {
  it("returns IR names without requiring a write", () => {
    const c = jsonGet("c1", "https://ex.com/api/items?q=hi");
    const ir = rebuildIr([recordObservation({ candidate: c })], [c]);
    const plan = planCompile({ ir, candidates: [c], candidateIds: [c.id] });
    assert.equal(plan.tools.length, 1);
    assert.equal(plan.selected[0]?.suggestedName, plan.tools[0]?.name);
    assert.equal(plan.skippedOther.length, 0);
  });

  it("does not compile kind=other", () => {
    const c: ApiCandidate = {
      id: "asset",
      method: "GET",
      url: "https://ex.com/static/app.js",
      status: 200,
      requestHeaders: {},
      contentType: "application/javascript",
      resourceHint: "script",
    };
    const ir = rebuildIr([], [c]);
    assert.equal(ir[0]?.kind, "other");
    const plan = planCompile({
      ir,
      candidates: [c],
      endpointIds: ir.map((e) => e.id),
    });
    assert.equal(plan.tools.length, 0);
    assert.equal(plan.skippedOther.length, 1);
  });
});
