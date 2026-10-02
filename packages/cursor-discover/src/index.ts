import { Agent } from "@cursor/sdk";
import { ToolDefSchema, type ApiCandidate, type ToolDef } from "@auto-mcp/shared";
import { candidateSummaryForPrompt } from "@auto-mcp/explorer";
import { z } from "zod";

export {
  streamSiteChat,
  ensureChatAgent,
  makeChatMessage,
  summarizePayload,
  collectActivityFromEvents,
  formatInventoryForPrompt,
  type ChatStreamEvent,
  type SiteChatContext,
} from "./chat.js";
export {
  buildBrowserCustomTools,
  type BrowserToolCallbacks,
  type SiteInventorySnapshot,
  type SiteToolInventoryItem,
  type SiteCapabilityInventoryItem,
  type PublishToolResult,
} from "./browser-tools.js";
export { analyzeCoverage, type CoverageAnalysis } from "./coverage.js";
export {
  KNOWN_PACKS,
  adapterIdToPack,
  assertPackName,
  resolvePackFile,
  listPackFiles,
  readPackFile,
  writePackFile,
  applyPackPatch,
  runPackTests,
  type PackTestResult,
} from "./pack-author.js";

const ProposedToolsSchema = z.object({
  tools: z.array(ToolDefSchema),
});

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in agent response");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export interface ProposeOptions {
  apiKey: string;
  candidates: ApiCandidate[];
  siteName: string;
  baseUrl: string;
  cwd?: string;
}

export async function proposeToolsWithCursorSdk(
  options: ProposeOptions,
): Promise<ToolDef[]> {
  if (!options.apiKey) {
    throw new Error("CURSOR_API_KEY is required for AI propose");
  }
  if (options.candidates.length === 0) {
    return [];
  }

  const prompt = `You are helping build an MCP server from captured HTTP traffic.

Site: ${options.siteName}
Base URL: ${options.baseUrl}

From the API candidates below (PII already redacted), propose a small set of useful MCP tools
focused on student list / academic lookup if present. Prefer stable JSON APIs over static assets.

Return ONLY valid JSON matching:
{
  "tools": [
    {
      "name": "snake_case_name",
      "description": "what it does",
      "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
      "url": "absolute URL without varying query if possible",
      "inputSchema": { "type": "object", "properties": { ... } },
      "argBindings": {
        "argName": { "in": "query"|"body"|"path"|"header", "key": "actualParam" }
      },
      "headers": {},
      "approved": true
    }
  ]
}

Candidates:

${candidateSummaryForPrompt(options.candidates)}
`;

  const result = await Agent.prompt(prompt, {
    apiKey: options.apiKey,
    model: { id: "auto" },
    local: { cwd: options.cwd ?? process.cwd() },
  });

  if (result.status !== "finished") {
    throw new Error(
      `Cursor agent failed (${result.status}): ${result.error?.message ?? result.result ?? "unknown error"}`,
    );
  }

  const text = result.result ?? "";
  if (!text.trim()) {
    throw new Error("Cursor agent returned empty result");
  }
  const parsed = ProposedToolsSchema.parse(extractJsonObject(text));
  return parsed.tools;
}

export function isCursorSdkConfigured(apiKey?: string): boolean {
  return Boolean(apiKey && apiKey.trim().length > 0);
}
