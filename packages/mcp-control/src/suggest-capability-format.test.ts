import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EndpointIr, McpSite, ToolDef } from "@auto-mcp/shared";
import { suggestFormatForPrimitive } from "./suggest-capability-format.js";

function baseSite(overrides: Partial<McpSite> = {}): McpSite {
  return {
    id: "s",
    name: "t",
    baseUrl: "https://api.example.com/",
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
    ...overrides,
  };
}

function tool(name: string): ToolDef {
  return {
    name,
    description: "d",
    method: "GET",
    url: "https://api.example.com/x",
    approved: true,
  } as unknown as ToolDef;
}

describe("suggestFormatForPrimitive", () => {
  it("suggests http when no JSON signals", () => {
    const site = baseSite();
    const r = suggestFormatForPrimitive(site, tool("get_html"));
    assert.equal(r.recommended.format, "generic.http");
  });

  it("suggests unwrap for data.* keys", () => {
    const site = baseSite({
      endpointIr: [
        {
          id: "ir1",
          key: "k",
          method: "GET",
          urlTemplate: "https://api.example.com/items",
          kind: "rest",
          suggestedName: "get_items",
          compiledPrimitive: "get_items",
          responseKeys: ["data.id", "data.name"],
        } as unknown as EndpointIr,
      ],
    });
    const r = suggestFormatForPrimitive(site, tool("get_items"));
    assert.ok(
      r.recommended.format === "generic.jmespath" ||
        (r.recommended.format === "generic.json" &&
          (r.recommended.formatOptions as { unwrap?: string[] })?.unwrap?.[0] ===
            "data"),
    );
  });

  it("suggests json unwrap for single wrapper root", () => {
    const site = baseSite({
      tools: [tool("get_payload")],
      endpointIr: [
        {
          id: "ir2",
          key: "k2",
          method: "GET",
          urlTemplate: "https://api.example.com/p",
          kind: "rest",
          suggestedName: "get_payload",
          compiledPrimitive: "get_payload",
          responseKeys: ["data"],
        } as unknown as EndpointIr,
      ],
    });
    const r = suggestFormatForPrimitive(site, tool("get_payload"));
    assert.equal(r.recommended.format, "generic.json");
    assert.deepEqual(r.recommended.formatOptions, { unwrap: ["data"] });
  });
});
