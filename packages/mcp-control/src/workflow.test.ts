import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextAfterApprove,
  summarizePublishGap,
  summarizeSeedReadiness,
} from "./workflow.js";
import type { McpSite } from "@auto-mcp/shared";

describe("summarizeSeedReadiness", () => {
  it("reports Jira adapter with locked seeds when primitives do not unlock pipeline", () => {
    const site = {
      id: "x",
      name: "Jira",
      baseUrl: "https://example.atlassian.net",
      explorePath: "/",
      status: "ready",
      cursorMcpKey: "auto-mcp-x",
      profileDir: "/tmp",
      tools: [
        {
          name: "noise_only",
          description: "n",
          method: "GET",
          url: "https://example.atlassian.net/rest/api/3/myself",
          approved: true,
        },
      ],
      candidates: [],
      proposedTools: [],
      createdAt: "",
      updatedAt: "",
    } as unknown as McpSite;
    const r = summarizeSeedReadiness(site);
    assert.equal(r.adapterId, "jira");
    assert.equal(r.hasPublishableCapabilities, false);
    assert.equal(r.effectiveCapabilityNames.length, 0);
  });
});

describe("summarizePublishGap", () => {
  it("generic-replay maps every approved primitive to an MCP tool name", () => {
    const site = {
      id: "g",
      name: "Example",
      baseUrl: "https://example.com/",
      explorePath: "/",
      status: "ready",
      cursorMcpKey: "auto-mcp-g",
      profileDir: "/tmp",
      tools: [
        {
          name: "get_items",
          description: "a",
          method: "GET",
          url: "https://example.com/api/items",
          approved: true,
        },
        {
          name: "get_profile",
          description: "b",
          method: "GET",
          url: "https://example.com/api/me",
          approved: true,
        },
      ],
      candidates: [],
      proposedTools: [],
      createdAt: "",
      updatedAt: "",
    } as unknown as McpSite;
    const gap = summarizePublishGap(site);
    assert.deepEqual(gap.unmappedPrimitives, []);
    assert.equal(gap.mcpToolNames.length, 2);
    assert.match(gap.publishHint, /Hosted MCP tools/);
  });
});

describe("nextAfterApprove", () => {
  it("warns when capabilities empty", () => {
    const site = {
      id: "x",
      name: "Jira",
      baseUrl: "https://example.atlassian.net",
      explorePath: "/",
      status: "ready",
      cursorMcpKey: "auto-mcp-x",
      profileDir: "/tmp",
      tools: [
        {
          name: "noise_only",
          description: "n",
          method: "GET",
          url: "https://example.atlassian.net/rest/api/3/myself",
          approved: true,
        },
      ],
      candidates: [],
      proposedTools: [],
      createdAt: "",
      updatedAt: "",
    } as unknown as McpSite;
    const msg = nextAfterApprove(site);
    assert.match(msg, /no business capabilities/i);
    assert.match(msg, /jira/);
  });
});
