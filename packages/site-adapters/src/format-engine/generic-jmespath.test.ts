import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { genericJmespathHandler } from "./handlers/generic-jmespath.js";
import { parseJmespathExpression } from "./handlers/generic-jmespath.js";

const minimalSite = {
  id: "s",
  name: "n",
  baseUrl: "https://example.com/",
  explorePath: "/",
  status: "ready" as const,
  cursorMcpKey: "k",
  profileDir: "/tmp",
  tools: [],
  candidates: [],
  proposedTools: [],
  capabilities: [],
  chatAgentId: null,
  chatMessages: [],
  exploreRounds: [],
  exploreFocus: null,
  createdAt: "",
  updatedAt: "",
  lastAuthAt: null,
  lastExploreAt: null,
  replayMode: "http" as const,
  observedActions: [],
  endpointIr: [],
  adapterPackId: null,
  capabilityPublishMode: "auto" as const,
};

describe("parseJmespathExpression", () => {
  it("rejects semicolons", () => {
    assert.throws(() =>
      parseJmespathExpression({ expression: "a;b" }),
    );
  });
});

describe("genericJmespathHandler", () => {
  it("searches nested data.items", () => {
    const result = genericJmespathHandler.format({
      format: "generic.jmespath",
      body: JSON.stringify({ data: { items: [{ id: 1 }] } }),
      meta: { capability: "x", status: 200, ok: true },
      args: {},
      site: minimalSite,
      formatOptions: { expression: "data.items" },
    });
    const sc = result.structuredContent as { data?: unknown[] };
    assert.deepEqual(sc.data, [{ id: 1 }]);
    assert.equal(result.isError, undefined);
  });

  it("fails on invalid JSON body", () => {
    const result = genericJmespathHandler.format({
      format: "generic.jmespath",
      body: "not-json",
      meta: { capability: "x", status: 200, ok: true },
      args: {},
      site: minimalSite,
      formatOptions: { expression: "data" },
    });
    assert.equal(result.isError, true);
  });
});
