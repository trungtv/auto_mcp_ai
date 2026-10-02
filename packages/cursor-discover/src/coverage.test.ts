import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeCoverage } from "./coverage.js";
import type { ApiCandidate } from "@auto-mcp/shared";

describe("analyzeCoverage", () => {
  it("splits covered vs candidateOnly and flags orphan caps", () => {
    const candidates: ApiCandidate[] = [
      {
        id: "c1",
        method: "GET",
        url: "https://ex.atlassian.net/rest/api/3/search",
        status: 200,
        requestHeaders: {},
      },
      {
        id: "c2",
        method: "GET",
        url: "https://ex.atlassian.net/rest/api/2/universal_avatar/view/type/project/avatar/1",
        status: 200,
        requestHeaders: {},
      },
    ];
    const analysis = analyzeCoverage({
      candidates,
      primitives: [
        {
          name: "jira_search_issues",
          method: "GET",
          url: "https://ex.atlassian.net/rest/api/3/search?jql=x",
          approved: true,
        },
      ],
      capabilities: [
        {
          name: "search_issues",
          bind: { kind: "primitive", primitive: "jira_search_issues" },
        },
        {
          name: "orphan_cap",
          bind: { kind: "primitive", primitive: "missing_prim" },
        },
      ],
    });
    assert.equal(analysis.summary.covered, 1);
    assert.equal(analysis.summary.candidateOnly, 1);
    assert.equal(analysis.covered[0]?.primitiveName, "jira_search_issues");
    assert.deepEqual(analysis.covered[0]?.capabilityNames, ["search_issues"]);
    assert.ok(
      analysis.capabilityWithoutRecentCandidate.some((x) => x.capabilityName === "orphan_cap"),
    );
  });

  it("matches IR.key to primitive url (query stripped)", () => {
    const analysis = analyzeCoverage({
      candidates: [],
      endpointIr: [
        {
          id: "e1",
          key: "GET https://ex.atlassian.net/rest/api/3/search",
          method: "GET",
          urlTemplate: "https://ex.atlassian.net/rest/api/3/search",
          kind: "data_api",
          params: [{ name: "jql", in: "query", samples: ["x"], inferredType: "string" }],
          responseKeys: [],
          evidenceActionIds: [],
          candidateIds: ["c1"],
          suggestedName: "search_issues",
        },
      ],
      primitives: [
        {
          name: "jira_search_issues",
          method: "GET",
          url: "https://ex.atlassian.net/rest/api/3/search?jql=x",
          approved: true,
        },
      ],
      capabilities: [
        {
          name: "search_issues",
          bind: { kind: "primitive", primitive: "jira_search_issues" },
        },
      ],
    });
    assert.equal(analysis.summary.covered, 1);
    assert.equal(analysis.summary.endpointIr, 1);
    assert.equal(analysis.covered[0]?.primitiveName, "jira_search_issues");
    assert.equal(analysis.covered[0]?.irKey, "GET https://ex.atlassian.net/rest/api/3/search");
  });
});
