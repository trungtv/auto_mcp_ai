import type { EndpointIr, McpSite, ToolDef } from "@auto-mcp/shared";
import { outputSchemaFromResponseKeys } from "@auto-mcp/shared";

export type GenericFormatId =
  | "generic.http"
  | "generic.json"
  | "generic.jmespath";

export type FormatSuggestion = {
  format: GenericFormatId;
  formatOptions?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  rationale: string;
};

export type SuggestCapabilityFormatResult = {
  primitive: string;
  endpointIrId?: string;
  recommended: FormatSuggestion;
  alternatives: FormatSuggestion[];
};

const WRAPPER_KEYS = new Set(["data", "result", "payload", "items", "response"]);

function irForPrimitive(site: McpSite, primitiveName: string): EndpointIr | undefined {
  return (site.endpointIr ?? []).find(
    (ir) => ir.compiledPrimitive === primitiveName,
  );
}

function irById(site: McpSite, id: string): EndpointIr | undefined {
  return (site.endpointIr ?? []).find((ir) => ir.id === id);
}

function keysForSuggest(ir: EndpointIr | undefined): string[] {
  if (!ir) return [];
  if (ir.lastContract?.ok && ir.lastContract.matchedKeys?.length) {
    return [...ir.lastContract.matchedKeys];
  }
  return ir.responseKeys ?? [];
}

function looksLikeJson(tool: ToolDef, ir: EndpointIr | undefined): boolean {
  if (keysForSuggest(ir).length > 0) return true;
  const ct =
    tool.headers?.["content-type"] ?? tool.headers?.["Content-Type"] ?? "";
  if (String(ct).toLowerCase().includes("json")) return true;
  if (tool.method === "GET" && tool.url.includes("/api/")) return true;
  return false;
}

function nestedKeyExpression(keys: string[]): string | undefined {
  const dotted = keys.filter((k) => k.includes("."));
  if (dotted.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const k of dotted) {
    const prefix = k.split(".")[0]!;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [p, c] of counts) {
    if (c > bestCount) {
      best = p;
      bestCount = c;
    }
  }
  if (!best) return undefined;
  const under = dotted.filter((k) => k.startsWith(`${best}.`));
  if (under.length === 0) return best;
  const suffixes = under.map((k) => k.slice(best.length + 1));
  const firstSeg = suffixes[0]?.split(".")[0];
  if (firstSeg && suffixes.every((s) => s.startsWith(firstSeg))) {
    return `${best}.${firstSeg}`;
  }
  return best;
}

function singleWrapperKey(keys: string[]): string | undefined {
  const top = new Set(keys.map((k) => k.split(".")[0]!));
  for (const w of WRAPPER_KEYS) {
    if (top.has(w) && keys.some((k) => k === w || k.startsWith(`${w}.`))) {
      return w;
    }
  }
  if (top.size === 1) {
    const only = [...top][0]!;
    if (keys.some((k) => k.includes("."))) return only;
  }
  return undefined;
}

export function suggestFormatForPrimitive(
  site: McpSite,
  tool: ToolDef,
  ir?: EndpointIr,
): SuggestCapabilityFormatResult {
  const resolvedIr = ir ?? irForPrimitive(site, tool.name);
  const keys = keysForSuggest(resolvedIr);
  const alternatives: FormatSuggestion[] = [];

  if (!looksLikeJson(tool, resolvedIr)) {
    const recommended: FormatSuggestion = {
      format: "generic.http",
      rationale: "No JSON response keys or content-type; use HTTP preview.",
    };
    alternatives.push({
      format: "generic.json",
      rationale: "Try if body is JSON despite missing IR keys.",
    });
    return {
      primitive: tool.name,
      endpointIrId: resolvedIr?.id,
      recommended,
      alternatives,
    };
  }

  const outputSchema =
    outputSchemaFromResponseKeys(keys.length ? keys : ["data"]) ?? undefined;

  const wrapper = singleWrapperKey(keys);
  const nestedExpr = nestedKeyExpression(keys);

  if (nestedExpr && nestedExpr.includes(".")) {
    const recommended: FormatSuggestion = {
      format: "generic.jmespath",
      formatOptions: { expression: nestedExpr },
      outputSchema,
      rationale: `Nested response keys suggest JMESPath \`${nestedExpr}\`.`,
    };
    alternatives.push(
      {
        format: "generic.json",
        rationale: "Full parsed JSON without projection.",
      },
      ...(wrapper
        ? [
            {
              format: "generic.json" as const,
              formatOptions: { unwrap: [wrapper] },
              rationale: `Unwrap root key \`${wrapper}\` via generic.json.`,
            },
          ]
        : []),
      {
        format: "generic.http",
        rationale: "Raw HTTP preview fallback.",
      },
    );
    return {
      primitive: tool.name,
      endpointIrId: resolvedIr?.id,
      recommended,
      alternatives,
    };
  }

  if (wrapper) {
    const recommended: FormatSuggestion = {
      format: "generic.json",
      formatOptions: { unwrap: [wrapper] },
      outputSchema,
      rationale: `Single wrapper key \`${wrapper}\` at root; unwrap for agent-friendly data.`,
    };
    alternatives.push(
      {
        format: "generic.jmespath",
        formatOptions: { expression: wrapper },
        rationale: `Same as unwrap via JMESPath \`${wrapper}\`.`,
      },
      {
        format: "generic.json",
        rationale: "Full JSON object without unwrap.",
      },
    );
    return {
      primitive: tool.name,
      endpointIrId: resolvedIr?.id,
      recommended,
      alternatives,
    };
  }

  const recommended: FormatSuggestion = {
    format: "generic.json",
    outputSchema,
    rationale: "Flat or shallow JSON; parse full body into data.",
  };
  alternatives.push({
    format: "generic.http",
    rationale: "Raw preview if JSON parse fails at runtime.",
  });

  return {
    primitive: tool.name,
    endpointIrId: resolvedIr?.id,
    recommended,
    alternatives,
  };
}

export function suggestCapabilityFormatOp(
  site: McpSite,
  args: { primitive?: string; endpointIrId?: string },
): SuggestCapabilityFormatResult {
  const endpointIrId = args.endpointIrId
    ? String(args.endpointIrId).trim()
    : "";
  const primitiveName = args.primitive ? String(args.primitive).trim() : "";

  if (endpointIrId) {
    const ir = irById(site, endpointIrId);
    if (!ir) throw new Error(`Endpoint IR not found: ${endpointIrId}`);
    if (!ir.compiledPrimitive) {
      throw new Error(
        `Endpoint IR \`${endpointIrId}\` is not compiled. compile_endpoints first.`,
      );
    }
    const tool = site.tools.find(
      (t) => t.name === ir.compiledPrimitive && t.approved !== false,
    );
    if (!tool) {
      throw new Error(
        `Primitive \`${ir.compiledPrimitive}\` not found or not approved.`,
      );
    }
    return suggestFormatForPrimitive(site, tool, ir);
  }

  if (!primitiveName) {
    throw new Error("primitive or endpointIrId is required");
  }
  const tool = site.tools.find(
    (t) => t.name === primitiveName && t.approved !== false,
  );
  if (!tool) {
    throw new Error(
      `Primitive \`${primitiveName}\` not found or not approved.`,
    );
  }
  return suggestFormatForPrimitive(site, tool);
}
