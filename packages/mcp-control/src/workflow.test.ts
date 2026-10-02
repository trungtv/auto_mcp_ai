import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextAfterApprove,
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
