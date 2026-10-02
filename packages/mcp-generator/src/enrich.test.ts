import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichTool } from "./index.js";
import type { ToolDef } from "@auto-mcp/shared";

describe("enrichTool", () => {
  it("preserves inputSchema property defaults across upgrade", () => {
    const tool: ToolDef = {
      name: "jira_list_board_issues",
      description: "list",
      method: "GET",
      url: "https://example.atlassian.net/rest/agile/1.0/board/{boardId}/issue",
      argBindings: {
        boardId: { in: "path", key: "boardId" },
        maxResults: { in: "query", key: "maxResults" },
      },
      inputSchema: {
        type: "object",
        properties: {
          boardId: {
            type: "string",
            description: "Agile board id",
            default: "38",
          },
          maxResults: { type: "string", description: "page size" },
        },
        additionalProperties: true,
      },
      outputSchema: { type: "object", properties: {} },
      annotations: {},
      captureContext: {},
      headers: {},
      approved: true,
    };

    const next = enrichTool(tool);
    const props = (next.inputSchema as { properties: Record<string, { default?: unknown; description?: string }> })
      .properties;
    assert.equal(props.boardId?.default, "38");
    assert.equal(props.boardId?.description, "Agile board id");
    assert.equal(
      (next.inputSchema as { additionalProperties?: boolean }).additionalProperties,
      true,
    );
  });
});
