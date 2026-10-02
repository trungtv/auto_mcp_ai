import { z } from "zod";

export const ServerStatusSchema = z.enum([
  "needs_auth",
  "ready",
  "expired",
  "exploring",
]);
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const JsonSchemaSchema = z.record(z.unknown());

export const ToolAnnotationsSchema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .default({});
export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

/** GWT getProjects menu type (domain-specific); Integer ids resolved in site packs. */
export const ProjectTypeSchema = z.enum([
  "others",
  "final",
  "masters",
  "phds",
]);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const CaptureContextSchema = z
  .object({
    rpcService: z.string().optional(),
    rpcMethod: z.string().optional(),
    semester: z.string().optional(),
    classId: z.string().optional(),
    /** getProjects type filter when known (GWT sites). */
    projectType: ProjectTypeSchema.optional(),
    resourceHint: z.string().optional(),
    frozen: z.boolean().optional(),
  })
  .default({});
export type CaptureContext = z.infer<typeof CaptureContextSchema>;

/** Default output schema for site replay tools (structuredContent). */
export const DEFAULT_REPLAY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: { type: "number", description: "HTTP status code from replay" },
    ok: {
      type: "boolean",
      description: "True when HTTP 2xx and body is not an obvious error",
    },
    contentTypeHint: { type: "string" },
    byteLength: { type: "number" },
    truncated: { type: "boolean" },
    bodyPreview: {
      type: "string",
      description: "Response body preview (may be truncated)",
    },
    captureContext: {
      type: "object",
      description: "Frozen capture metadata (semester, classId, RPC, …)",
    },
  },
  required: ["status", "ok", "bodyPreview", "truncated", "byteLength"],
};

export const ToolDefSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url(),
  inputSchema: JsonSchemaSchema.default({
    type: "object",
    properties: {},
  }),
  outputSchema: JsonSchemaSchema.default(DEFAULT_REPLAY_OUTPUT_SCHEMA),
  annotations: ToolAnnotationsSchema,
  captureContext: CaptureContextSchema,
  /** Query/body template keys filled from tool arguments */
  argBindings: z
    .record(
      z.object({
        in: z.enum(["query", "body", "path", "header"]),
        key: z.string(),
      }),
    )
    .default({}),
  headers: z.record(z.string()).default({}),
  bodyTemplate: z.unknown().optional(),
  approved: z.boolean().default(true),
});
export type ToolDef = z.infer<typeof ToolDefSchema>;

export const ApiCandidateSchema = z.object({
  id: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string(),
  status: z.number().optional(),
  requestHeaders: z.record(z.string()).default({}),
  requestBodySample: z.unknown().optional(),
  responseBodySample: z.unknown().optional(),
  contentType: z.string().optional(),
  resourceHint: z.string().optional(),
  /** GWT-RPC service interface, e.g. com.soict...DataService */
  rpcService: z.string().optional(),
  /** GWT-RPC method name, e.g. getCourses */
  rpcMethod: z.string().optional(),
  discoveredAt: z.string().optional(),
  exploreRound: z.number().int().optional(),
});
export type ApiCandidate = z.infer<typeof ApiCandidateSchema>;

export const UiGestureSchema = z.enum(["click", "fill", "goto", "unknown"]);
export type UiGesture = z.infer<typeof UiGestureSchema>;

export const ObservedUiSchema = z.object({
  pageUrl: z.string(),
  gesture: UiGestureSchema,
  targetText: z.string().optional(),
  snapshotExcerpt: z.string().optional(),
});
export type ObservedUi = z.infer<typeof ObservedUiSchema>;

export const ObservedActionSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  observedAt: z.string(),
  exploreRound: z.number().int().optional(),
  ui: ObservedUiSchema.optional(),
  network: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string(),
    status: z.number().optional(),
    contentType: z.string().optional(),
  }),
  requestSketch: z.object({
    queryKeys: z.array(z.string()).default([]),
    bodyKeys: z.array(z.string()).default([]),
  }),
  responseSketch: z.object({
    topKeys: z.array(z.string()).default([]),
    rpcMethod: z.string().optional(),
  }),
});
export type ObservedAction = z.infer<typeof ObservedActionSchema>;

export const EndpointIrKindSchema = z.enum(["data_api", "action_api", "other"]);
export type EndpointIrKind = z.infer<typeof EndpointIrKindSchema>;

export const EndpointIrParamSchema = z.object({
  name: z.string(),
  in: z.enum(["query", "body", "path"]),
  samples: z.array(z.string()).default([]),
  inferredType: z.enum(["string", "number", "boolean", "object"]).default("string"),
});
export type EndpointIrParam = z.infer<typeof EndpointIrParamSchema>;

export const IrContractResultSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  status: z.number(),
  matchedKeys: z.array(z.string()).default([]),
  missingKeys: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type IrContractResult = z.infer<typeof IrContractResultSchema>;

export const IrMutationResultSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  param: z.string(),
  from: z.string(),
  to: z.string(),
  status: z.number(),
  note: z.string().optional(),
});
export type IrMutationResult = z.infer<typeof IrMutationResultSchema>;

export const EndpointIrSchema = z.object({
  id: z.string(),
  key: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  urlTemplate: z.string(),
  kind: EndpointIrKindSchema,
  params: z.array(EndpointIrParamSchema).default([]),
  responseKeys: z.array(z.string()).default([]),
  evidenceActionIds: z.array(z.string()).default([]),
  candidateIds: z.array(z.string()).default([]),
  suggestedName: z.string(),
  compiledPrimitive: z.string().optional(),
  lastContract: IrContractResultSchema.optional(),
  lastMutation: IrMutationResultSchema.optional(),
});
export type EndpointIr = z.infer<typeof EndpointIrSchema>;

export type GwtRpcRef = { service: string; method: string };

/** GWT-RPC payload starts with version|flags|… */
export function isGwtRpcBody(body: unknown): boolean {
  return typeof body === "string" && /^\d+\|\d+\|/.test(body);
}

/** Parse service + method from a GWT-RPC request body. */
export function parseGwtRpc(body: unknown): GwtRpcRef | null {
  if (typeof body !== "string") return null;
  const m = body.match(/(com\.[\w.]+)\|(\w+)\|/);
  if (!m?.[1] || !m[2]) return null;
  return { service: m[1], method: m[2] };
}

export function extractSemester(body: unknown): string | undefined {
  if (typeof body !== "string") return undefined;
  const m = body.match(/\|(20\d{3})\|/);
  return m?.[1];
}

/**
 * Best-effort class id from GWT body (numeric id near getCourseMembers / class payloads).
 * Prefers tokens that look like class ids (6+ digits, not semester year).
 */
export function extractClassId(body: unknown): string | undefined {
  if (typeof body !== "string") return undefined;
  if (!/getCourseMembers/i.test(body) && !/Class\//i.test(body)) {
    // Still try common pattern: |168484| after Long type in staff RPCs
  }
  const candidates = [...body.matchAll(/\|(\d{5,12})\|/g)].map((m) => m[1]!);
  const filtered = candidates.filter((id) => !/^20\d{3}$/.test(id));
  return filtered[0];
}

/**
 * Extract Integer type-id list from a getProjects GWT body tail:
 * `…|8|9|<n>|10|id0|…|9|0|` (8=semester string ref, 9=ArrayList, 10=Integer).
 */
export function extractProjectTypeIds(body: unknown): number[] | undefined {
  if (typeof body !== "string") return undefined;
  if (!/\|getProjects\|/.test(body)) return undefined;
  const m = body.match(/\|8\|9\|(\d+)\|((?:10\|\d+\|)*)9\|0\|$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const ids = [...(m[2] ?? "").matchAll(/10\|(\d+)\|/g)].map((x) =>
    Number(x[1]),
  );
  if (ids.length !== n || ids.some((id) => !Number.isFinite(id))) {
    return undefined;
  }
  return ids;
}

/** Map known GWT type-id lists → domain projectType. */
export function projectTypeFromIds(ids: number[]): ProjectType | undefined {
  const key = ids.join(",");
  switch (key) {
    case "1":
      return "final";
    case "0,3,2":
      return "others";
    case "5,4":
      return "masters";
    case "6":
      return "phds";
    default:
      return undefined;
  }
}

export function buildCaptureContext(opts: {
  body?: unknown;
  rpcService?: string;
  rpcMethod?: string;
  resourceHint?: string;
  frozen?: boolean;
}): CaptureContext {
  const rpc =
    (opts.rpcService && opts.rpcMethod
      ? { service: opts.rpcService, method: opts.rpcMethod }
      : null) ?? parseGwtRpc(opts.body);
  const frozen =
    opts.frozen ?? (isGwtRpcBody(opts.body) || Boolean(rpc));
  const typeIds = extractProjectTypeIds(opts.body);
  return {
    rpcService: rpc?.service,
    rpcMethod: rpc?.method,
    semester: extractSemester(opts.body),
    classId: extractClassId(opts.body),
    projectType: typeIds ? projectTypeFromIds(typeIds) : undefined,
    resourceHint: opts.resourceHint,
    frozen,
  };
}

export function snakeCaseRpcMethod(method: string): string {
  return method
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .slice(0, 64);
}

export const ChatRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatActivityStepSchema = z.object({
  kind: z.enum(["status", "thinking", "tool"]),
  at: z.string(),
  text: z.string().optional(),
  callId: z.string().optional(),
  toolName: z.string().optional(),
  toolStatus: z.string().optional(),
  argsSummary: z.string().optional(),
  resultSummary: z.string().optional(),
});
export type ChatActivityStep = z.infer<typeof ChatActivityStepSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: ChatRoleSchema,
  content: z.string(),
  createdAt: z.string(),
  toolName: z.string().optional(),
  activity: z.array(ChatActivityStepSchema).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ExploreRoundSchema = z.object({
  id: z.number().int(),
  focus: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  newCandidateCount: z.number().int().default(0),
});
export type ExploreRound = z.infer<typeof ExploreRoundSchema>;

export function candidateKey(
  c: Pick<ApiCandidate, "method" | "url" | "requestBodySample" | "rpcMethod">,
): string {
  let base: string;
  try {
    const u = new URL(c.url);
    base = `${c.method} ${u.origin}${u.pathname}`;
  } catch {
    base = `${c.method} ${c.url.split("?")[0]}`;
  }
  const rpc =
    c.rpcMethod ?? parseGwtRpc(c.requestBodySample)?.method ?? undefined;
  return rpc ? `${base}#${rpc}` : base;
}

export const AuthSnapshotSchema = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string().default("/"),
      expires: z.number().optional(),
      httpOnly: z.boolean().optional(),
      secure: z.boolean().optional(),
      sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
    }),
  ),
  /** Captured auth-related request headers (Authorization, CSRF, etc.) */
  authHeaders: z.record(z.string()).default({}),
  /**
   * Auth headers keyed by request origin (IdP vs API).
   * `authHeaders` remains the slice for `origin` (site.baseUrl) for HTTP replay.
   */
  authHeadersByOrigin: z.record(z.record(z.string())).default({}),
  capturedAt: z.string(),
  origin: z.string(),
});
export type AuthSnapshot = z.infer<typeof AuthSnapshotSchema>;

export const ReplayModeSchema = z.enum(["http", "browser"]);
export type ReplayMode = z.infer<typeof ReplayModeSchema>;

/** Declarative business capability recipe (Cursor upsert via meta MCP). */
export const CapabilityBindDefaultsSchema = z.object({
  semester: z.string().optional(),
  classId: z.string().optional(),
  projectType: ProjectTypeSchema.optional(),
});
export type CapabilityBindDefaults = z.infer<
  typeof CapabilityBindDefaultsSchema
>;

/**
 * Domain formatter id owned by a site pack (e.g. jira.issues).
 * Closed enum removed — packs declare knownFormats; core accepts any pack id.
 */
export const CapabilityFormatSchema = z
  .string()
  .min(1)
  .regex(
    /^[\w.-]+$/,
    "format must be a pack formatter id (letters, digits, _ . -)",
  );
export type CapabilityFormat = z.infer<typeof CapabilityFormatSchema>;

/** Documented examples for MCP tool descriptions (not an exhaustive allow-list). */
export const CAPABILITY_FORMAT_EXAMPLES = [
  "jira.issues",
  "jira.board_issues",
  "jira.issue",
  "jira.sprints",
  "jira.transitions",
  "jira.comment",
  "jira.transition",
] as const;

/** @deprecated Use CAPABILITY_FORMAT_EXAMPLES — kept for callers during migration. */
export const CAPABILITY_FORMAT_VALUES: string[] = [
  ...CAPABILITY_FORMAT_EXAMPLES,
];

export const CapabilityArgMutationsSchema = z.object({
  semester: z.boolean().optional(),
  classId: z.boolean().optional(),
  projectType: z.boolean().optional(),
});

export const CapabilityBindPrimitiveSchema = z.object({
  kind: z.literal("primitive"),
  primitive: z.string().min(1),
  /** Optional IR id; compiledPrimitive must equal `primitive`. */
  endpointIrId: z.string().min(1).optional(),
  /** 1:N implementations; runtime picks lastContract.ok newest. */
  endpointIrIds: z.array(z.string().min(1)).min(1).max(8).optional(),
  argMutations: CapabilityArgMutationsSchema.optional(),
  /** Applied before agent args (e.g. projectType=final for DATN capability). */
  defaults: CapabilityBindDefaultsSchema.optional(),
  /** Domain formatter id (e.g. jira.issue) — agent-facing structured output. */
  format: CapabilityFormatSchema.optional(),
});
export type CapabilityBindPrimitive = z.infer<
  typeof CapabilityBindPrimitiveSchema
>;

/**
 * Pipeline step: map capability input / prior step structuredContent → primitive args.
 * Template values: `{{input.issueKey}}`, `{{steps.0.issue.key}}`.
 */
export const CapabilityPipelineStepSchema = z.object({
  primitive: z.string().min(1),
  args: z.record(z.string()).default({}),
  format: CapabilityFormatSchema.optional(),
  argMutations: CapabilityArgMutationsSchema.optional(),
  defaults: CapabilityBindDefaultsSchema.optional(),
});
export type CapabilityPipelineStep = z.infer<
  typeof CapabilityPipelineStepSchema
>;

export const CapabilityBindPipelineSchema = z.object({
  kind: z.literal("pipeline"),
  steps: z.array(CapabilityPipelineStepSchema).min(1).max(5),
  /** Optional final format hint (usually last step already has format). */
  format: CapabilityFormatSchema.optional(),
});
export type CapabilityBindPipeline = z.infer<
  typeof CapabilityBindPipelineSchema
>;

export const CapabilityBindSchema = z.discriminatedUnion("kind", [
  CapabilityBindPrimitiveSchema,
  CapabilityBindPipelineSchema,
]);
export type CapabilityBind = z.infer<typeof CapabilityBindSchema>;

/** Explicit IR ids on a primitive bind. `endpointIrIds` wins when set. */
export function boundEndpointIrIds(bind: CapabilityBind): string[] {
  if (bind.kind !== "primitive") return [];
  if (bind.endpointIrIds?.length) return [...bind.endpointIrIds];
  return bind.endpointIrId ? [bind.endpointIrId] : [];
}

export function outputSchemaFromResponseKeys(
  keys: string[],
): Record<string, unknown> | undefined {
  if (keys.length === 0) return undefined;
  const properties: Record<string, unknown> = {};
  for (const k of keys) {
    properties[k] = {
      description: `Observed response field \`${k}\``,
    };
  }
  return {
    type: "object",
    properties,
    additionalProperties: true,
  };
}

/**
 * Pick the live implementation: compiled + lastContract.ok, newest `at`.
 * Throws if none qualify — caller must test_endpoint_ir first.
 */
export function selectContractedEndpoint(
  catalog: EndpointIr[],
  ids: string[],
): EndpointIr {
  if (ids.length === 0) {
    throw new Error("No endpointIrIds to select");
  }
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const reasons: string[] = [];
  const ok: EndpointIr[] = [];
  for (const id of ids) {
    const ir = byId.get(id);
    if (!ir) {
      reasons.push(`${id}: not found`);
      continue;
    }
    if (!ir.compiledPrimitive) {
      reasons.push(`${id}: not compiled`);
      continue;
    }
    if (!ir.lastContract?.ok) {
      reasons.push(`${id}: lastContract not ok`);
      continue;
    }
    ok.push(ir);
  }
  if (ok.length === 0) {
    throw new Error(
      `No contracted endpoint IR (need compile + test_endpoint_ir confirm). ${reasons.join("; ")}`,
    );
  }
  ok.sort((a, b) =>
    (b.lastContract?.at ?? "").localeCompare(a.lastContract?.at ?? ""),
  );
  return ok[0]!;
}

export const CapabilityDefSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string(),
  inputSchema: JsonSchemaSchema.default({
    type: "object",
    properties: {},
  }),
  outputSchema: JsonSchemaSchema.optional(),
  annotations: ToolAnnotationsSchema.optional(),
  bind: CapabilityBindSchema,
  /** When false, hides this name (including adapter seeds with same name). */
  enabled: z.boolean().default(true),
  updatedAt: z.string(),
});
export type CapabilityDef = z.infer<typeof CapabilityDefSchema>;

export const McpSiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  explorePath: z.string().default("/#danh-sach-sinh-vien"),
  status: ServerStatusSchema,
  cursorMcpKey: z.string(),
  profileDir: z.string(),
  tools: z.array(ToolDefSchema).default([]),
  candidates: z.array(ApiCandidateSchema).default([]),
  proposedTools: z.array(ToolDefSchema).default([]),
  /** Declarative business capabilities stored for this site. */
  capabilities: z.array(CapabilityDefSchema).default([]),
  chatAgentId: z.string().nullable().default(null),
  chatMessages: z.array(ChatMessageSchema).default([]),
  exploreRounds: z.array(ExploreRoundSchema).default([]),
  exploreFocus: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastAuthAt: z.string().nullable().default(null),
  lastExploreAt: z.string().nullable().default(null),
  notes: z.string().optional(),
  /** http = snapshot fetch replay. browser = Playwright profile warm-up (OIDC/SPA). */
  replayMode: ReplayModeSchema.default("http"),
  observedActions: z.array(ObservedActionSchema).default([]),
  endpointIr: z.array(EndpointIrSchema).default([]),
});
export type McpSite = z.infer<typeof McpSiteSchema>;

export const ChatInputSchema = z.object({
  message: z.string().min(1),
});
export type ChatInput = z.infer<typeof ChatInputSchema>;

export const CreateSiteInputSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url(),
  explorePath: z.string().optional(),
});
export type CreateSiteInput = z.infer<typeof CreateSiteInputSchema>;

export const ApproveToolsInputSchema = z.object({
  toolNames: z.array(z.string()).optional(),
  tools: z.array(ToolDefSchema).optional(),
  candidateIds: z.array(z.string()).optional(),
});
export type ApproveToolsInput = z.infer<typeof ApproveToolsInputSchema>;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Common public-suffix / noise labels dropped when building a short MCP key. */
const HOST_NOISE = new Set([
  "www",
  "com",
  "net",
  "org",
  "edu",
  "gov",
  "vn",
  "co",
  "io",
  "app",
  "dev",
  "ac",
]);

/**
 * Cursor mcpServers key from website host — meaningful, stable, short.
 * e.g. https://your-domain.atlassian.net/ → `your-domain-atlassian`
 * Falls back to full host slug if stripping leaves nothing.
 */
export function defaultCursorKey(baseUrlOrId: string): string {
  // Legacy callers may still pass a bare UUID — keep a safe fallback.
  if (/^[0-9a-f-]{8,}$/i.test(baseUrlOrId) && !baseUrlOrId.includes(".")) {
    return `site-${baseUrlOrId.slice(0, 8)}`;
  }
  try {
    const host = new URL(
      baseUrlOrId.includes("://") ? baseUrlOrId : `https://${baseUrlOrId}`,
    ).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    const labels = host.split(".").filter(Boolean);
    const meaningful = labels.filter((p) => !HOST_NOISE.has(p));
    const picked = (meaningful.length > 0 ? meaningful : labels).slice(0, 3);
    const key = slugify(picked.join("-")).slice(0, 40);
    return key || `site-${slugify(host).slice(0, 12)}`;
  } catch {
    return `site-${slugify(baseUrlOrId).slice(0, 12) || "unknown"}`;
  }
}

/** Ensure key is unique among existing Cursor keys (append short suffix on clash). */
export function uniqueCursorKey(
  desired: string,
  taken: Iterable<string>,
  disambiguator?: string,
): string {
  const used = new Set(taken);
  if (!used.has(desired)) return desired;
  const suffix = (disambiguator ?? "x").replace(/[^a-z0-9]/gi, "").slice(0, 6) || "x";
  let candidate = `${desired.slice(0, 32)}-${suffix}`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${desired.slice(0, 28)}-${suffix}${n}`;
    n += 1;
  }
  return candidate;
}

/** Cap for GWT response samples / agent rawBody (keep string table via truncateGwtAware). */
export const GWT_BODY_LIMIT = 64_000;

/**
 * Truncate a GWT body for display without dropping the string table.
 * Keeps a head slice of the token stream + the trailing string table region.
 */
export function truncateGwtAware(
  raw: string,
  limit: number,
): { text: string; truncated: boolean } {
  if (raw.length <= limit) return { text: raw, truncated: false };
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("//OK") && !trimmed.startsWith("//EX")) {
    return { text: raw.slice(0, limit), truncated: true };
  }
  const tailBudget = Math.min(Math.floor(limit * 0.65), limit - 80);
  const headBudget = limit - tailBudget - 20;
  const head = raw.slice(0, Math.max(0, headBudget));
  const tail = raw.slice(-tailBudget);
  return {
    text: `${head}\n…[truncated ${raw.length - limit} bytes]…\n${tail}`,
    truncated: true,
  };
}
