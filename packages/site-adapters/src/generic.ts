import type { ToolDef } from "@auto-mcp/shared";
import type {
  AdapterContext,
  Capability,
  CapabilityResult,
  SiteAdapter,
} from "./types.js";

function primitiveToCapability(tool: ToolDef): Capability {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: (tool.inputSchema ?? {
      type: "object",
      properties: {},
    }) as Record<string, unknown>,
    outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
    annotations: tool.annotations,
    supportsMutation: false,
    async execute(ctx, args): Promise<CapabilityResult> {
      const result = await ctx.replay(tool, args, ctx.auth);
      const bodyText =
        typeof result.body === "string"
          ? result.body
          : JSON.stringify(result.body, null, 2);
      const ok =
        result.status >= 200 &&
        result.status < 300 &&
        !(typeof result.body === "string" && result.body.trimStart().startsWith("//EX"));
      const preview =
        bodyText.length > 48_000 ? bodyText.slice(0, 48_000) : bodyText;
      const structuredContent = {
        status: result.status,
        ok,
        bodyPreview: preview,
        truncated: bodyText.length > 48_000,
        byteLength: bodyText.length,
        captureContext: tool.captureContext ?? {},
      };
      return {
        content: [
          {
            type: "text",
            text: `HTTP ${result.status}\n\n${bodyText.slice(0, 2048)}`,
          },
        ],
        structuredContent,
        ...(ok ? {} : { isError: true }),
      };
    },
  };
}

/** Fallback when no specialized adapter matches: expose approved primitives. */
export const genericReplayAdapter: SiteAdapter = {
  id: "generic-replay",
  match: () => true,
  capabilities: ({ primitives }) =>
    primitives.filter((t) => t.approved !== false).map(primitiveToCapability),
};

export function listGenericCapabilities(ctx: AdapterContext): Capability[] {
  return genericReplayAdapter.capabilities(ctx);
}
