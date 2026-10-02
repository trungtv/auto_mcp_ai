import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CapabilityDef, McpSite, ToolDef } from "@auto-mcp/shared";
import { listCapabilitiesForSite } from "./registry.js";

function site(baseUrl: string, capabilities: CapabilityDef[] = []): McpSite {
  return {
    id: "s1",
    name: "t",
    baseUrl,
    explorePath: "/",
    status: "ready",
    cursorMcpKey: "t",
    profileDir: "/tmp",
    tools: [],
    candidates: [],
    proposedTools: [],
    capabilities,
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
}

function primitive(name: string): ToolDef {
  return {
    name,
    description: name,
    method: "GET",
    url: `https://example.test/${name}`,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    annotations: {},
    captureContext: {},
    argBindings: {},
    headers: {},
    approved: true,
  };
}

describe("listCapabilitiesForSite", () => {
  it("does not dump Jira primitives when no stored defs and seeds locked", () => {
    const caps = listCapabilitiesForSite({
      site: site("https://example.atlassian.net/"),
      primitives: [primitive("get_2_project_search"), primitive("jira_search")],
    });
    assert.deepEqual(
      caps.map((c) => c.name),
      [],
    );
  });

  it("generic-replay exposes a lone approved primitive on unknown host", () => {
    const caps = listCapabilitiesForSite({
      site: site("https://unknown-example.test/"),
      primitives: [primitive("get_status")],
    });
    assert.deepEqual(
      caps.map((c) => c.name),
      ["get_status"],
    );
  });

  it("lists Jira pipeline seed when primitives unlock it", () => {
    const caps = listCapabilitiesForSite({
      site: site("https://example.atlassian.net/"),
      primitives: [
        primitive("jira_get_issue"),
        primitive("jira_get_transitions"),
      ],
    });
    assert.deepEqual(
      caps.map((c) => c.name),
      ["get_issue_with_transitions"],
    );
  });

  it("lists stored Jira capability without dumping other primitives", () => {
    const stored: CapabilityDef = {
      name: "list_projects",
      description: "List Jira projects",
      inputSchema: { type: "object", properties: {} },
      bind: { kind: "primitive", primitive: "get_2_project_search" },
      enabled: true,
      updatedAt: new Date().toISOString(),
    };
    const caps = listCapabilitiesForSite({
      site: site("https://example.atlassian.net/", [stored]),
      primitives: [
        primitive("get_2_project_search"),
        primitive("jira_search"),
      ],
    });
    assert.deepEqual(
      caps.map((c) => c.name),
      ["list_projects"],
    );
  });

  it("generic-replay still exposes approved primitives when nothing stored", () => {
    const caps = listCapabilitiesForSite({
      site: site("https://vietstock.vn/"),
      primitives: [primitive("get_quote")],
    });
    assert.deepEqual(
      caps.map((c) => c.name),
      ["get_quote"],
    );
  });
});
