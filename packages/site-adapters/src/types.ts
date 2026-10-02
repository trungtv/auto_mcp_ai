import type {
  AuthSnapshot,
  CapabilityBindDefaults,
  CapabilityDef,
  McpSite,
  ProjectType,
  ToolAnnotations,
  ToolDef,
} from "@auto-mcp/shared";

export type ReplayFn = (
  tool: ToolDef,
  args: Record<string, unknown>,
  auth: AuthSnapshot,
) => Promise<{ status: number; body: unknown }>;

export type AdapterContext = {
  site: McpSite;
  auth: AuthSnapshot;
  primitives: ToolDef[];
  replay: ReplayFn;
};

export type CapabilityResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type Capability = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  /** True only after mutate/sign path is verified for this capability. */
  supportsMutation?: boolean;
  /** Present on seed capabilities for introspection / upsert templates. */
  bind?: CapabilityDef["bind"];
  execute: (
    ctx: AdapterContext,
    args: Record<string, unknown>,
  ) => Promise<CapabilityResult>;
};

export type MutatedRequest = {
  body?: string;
  headers?: Record<string, string>;
  url?: string;
};

export type MutateArgs = {
  semester?: string;
  classId?: string;
  projectType?: ProjectType;
};

/** Context passed to pack-owned domain formatters. */
export type FormatContext = {
  format: string;
  body: unknown;
  meta: Record<string, unknown>;
  includeRaw?: boolean;
  args: Record<string, unknown>;
  site: McpSite;
};

/**
 * Site pack contract: match host → seeds + optional format/applyArgs/mutateAndSign.
 * Adding a site = new folder + register in ADAPTERS (no core switch).
 */
export type SiteAdapter = {
  id: string;
  match: (site: McpSite) => boolean;
  /** Seed business capabilities (hardcoded defaults). */
  capabilities: (ctx: Pick<AdapterContext, "site" | "primitives">) => Capability[];
  /** Formatter ids this pack owns (e.g. jira.issues). */
  knownFormats?: readonly string[];
  supportsFormat?: (format: string) => boolean;
  /** Map agent args → primitive path/query/body args before replay. */
  applyArgs?: (
    format: string,
    args: Record<string, unknown>,
  ) => Record<string, unknown>;
  /** Domain structured output after replay. */
  formatCapability?: (ctx: FormatContext) => CapabilityResult;
  outputSchemaForFormat?: (format: string) => Record<string, unknown>;
  supportsArgMutation?: {
    semester?: boolean;
    classId?: boolean;
    projectType?: boolean;
  };
  mutateAndSign?: (tool: ToolDef, args: MutateArgs) => ToolDef;
};

export type ArgMutations = {
  semester?: boolean;
  classId?: boolean;
  projectType?: boolean;
};

export type { CapabilityBindDefaults };

export function findPrimitive(
  primitives: ToolDef[],
  name: string,
): ToolDef | undefined {
  return primitives.find((t) => t.approved !== false && t.name === name);
}

export function withRequestOverrides(
  tool: ToolDef,
  overrides: MutatedRequest,
): ToolDef {
  return {
    ...tool,
    url: overrides.url ?? tool.url,
    bodyTemplate:
      overrides.body !== undefined ? overrides.body : tool.bodyTemplate,
    headers: {
      ...(tool.headers ?? {}),
      ...(overrides.headers ?? {}),
    },
  };
}

/** Default supportsFormat from knownFormats. */
export function packSupportsFormat(
  adapter: SiteAdapter,
  format: string,
): boolean {
  if (adapter.supportsFormat) return adapter.supportsFormat(format);
  if (adapter.knownFormats) return adapter.knownFormats.includes(format);
  return false;
}
