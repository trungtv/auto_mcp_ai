import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextAfterApprove,
  summarizePublishGap,
  summarizeSeedReadiness,
} from "./workflow.js";
import type { McpSite } from "@auto-mcp/shared";

describe("summarizeSeedReadiness", () => {
  it("reports adapter with locked seeds when primitives do not unlock pipeline", () => {
    const site = {
      id: "x",
      name: "Jira",
      baseUrl: "https://example.atlassian.net",
      adapterPackId: "jira",
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
    assert.equal(r.adapterId, site.adapterPackId ?? "jira");
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

  it("generic curated reports unmapped primitives not covered by stored caps", () => {
    const site = {
      id: "g2",
      name: "Example",
      baseUrl: "https://example.com/",
      explorePath: "/",
      status: "ready",
      cursorMcpKey: "auto-mcp-g2",
      profileDir: "/tmp",
      capabilityPublishMode: "curated",
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
      capabilities: [
        {
          name: "get_items",
          description: "cap",
          enabled: true,
          updatedAt: "",
          bind: {
            kind: "primitive",
            primitive: "get_items",
            format: "generic.json",
          },
        },
      ],
      candidates: [],
      proposedTools: [],
      createdAt: "",
      updatedAt: "",
    } as unknown as McpSite;
    const gap = summarizePublishGap(site);
    assert.deepEqual(gap.unmappedPrimitives, ["get_profile"]);
    assert.equal(gap.mcpToolNames.length, 1);
  });
});

describe("nextAfterApprove", () => {
  it("warns when capabilities empty", () => {
    const site = {
      id: "x",
      name: "Example",
      baseUrl: "https://example.com/",
      explorePath: "/",
      status: "ready",
      cursorMcpKey: "auto-mcp-x",
      profileDir: "/tmp",
      capabilityPublishMode: "curated",
      tools: [
        {
          name: "noise_only",
          description: "n",
          method: "GET",
          url: "https://example.com/api/noise",
          approved: true,
        },
      ],
      capabilities: [],
      candidates: [],
      proposedTools: [],
      createdAt: "",
      updatedAt: "",
    } as unknown as McpSite;
    const msg = nextAfterApprove(site);
    assert.match(msg, /no business capabilities/i);
    assert.match(msg, /generic-replay/i);
  });
});
