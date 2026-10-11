import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { genericJsonHandler } from "./handlers/generic-json.js";

describe("genericJsonHandler", () => {
  it("parses JSON body into data", () => {
    const result = genericJsonHandler.format({
      format: "generic.json",
      body: '{"items":[1,2]}',
      meta: { capability: "x", status: 200, ok: true },
      args: {},
      site: {
        id: "s",
        name: "n",
        baseUrl: "https://example.com/",
        explorePath: "/",
        status: "ready",
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
        replayMode: "http",
        observedActions: [],
        endpointIr: [],
        adapterPackId: null,
        capabilityPublishMode: "auto",
      },
    });
    const sc = result.structuredContent as { data?: { items: number[] } };
    assert.deepEqual(sc.data, { items: [1, 2] });
    assert.equal(result.isError, undefined);
  });

  it("reports parseError on invalid JSON", () => {
    const result = genericJsonHandler.format({
      format: "generic.json",
      body: "not-json",
      meta: { capability: "x", status: 200, ok: true },
      args: {},
      site: {
        id: "s",
        name: "n",
        baseUrl: "https://example.com/",
        explorePath: "/",
        status: "ready",
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
        replayMode: "http",
        observedActions: [],
        endpointIr: [],
        adapterPackId: null,
        capabilityPublishMode: "auto",
      },
    });
    assert.equal(result.isError, true);
    assert.match(
      String((result.structuredContent as { parseError?: string }).parseError),
      /JSON/i,
    );
  });
});
