import {
  DEFAULT_REPLAY_OUTPUT_SCHEMA,
  buildCaptureContext,
  isGwtRpcBody,
  parseGwtRpc,
  snakeCaseRpcMethod,
  type ApiCandidate,
  type CaptureContext,
  type ToolAnnotations,
  type ToolDef,
} from "@auto-mcp/shared";

function toolNameFromUrl(method: string, url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split("/")
      .filter(Boolean)
      .map((p) => p.replace(/[^a-zA-Z0-9]/g, "_"))
      .filter(Boolean);
    const base = parts.slice(-3).join("_") || "api";
    return `${method.toLowerCase()}_${base}`.slice(0, 64);
  } catch {
    return `${method.toLowerCase()}_endpoint`;
  }
}

function toolNameFromCandidate(candidate: ApiCandidate): string {
  const rpc =
    candidate.rpcMethod ??
    parseGwtRpc(candidate.requestBodySample)?.method ??
    undefined;
  if (rpc) return snakeCaseRpcMethod(rpc);
  return toolNameFromUrl(candidate.method, candidate.url);
}

function inferQueryBindings(url: string): ToolDef["argBindings"] {
  const bindings: ToolDef["argBindings"] = {};
  try {
    const u = new URL(url);
    for (const key of u.searchParams.keys()) {
      const arg = key.replace(/[^a-zA-Z0-9_]/g, "_");
      bindings[arg] = { in: "query", key };
    }
  } catch {
    /* ignore */
  }
  return bindings;
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function ensureGwtHeaders(
  headers: Record<string, string>,
  body: unknown,
): Record<string, string> {
  const out = { ...headers };
  if (isGwtRpcBody(body)) {
    const hasCt = Object.keys(out).some((k) => k.toLowerCase() === "content-type");
    if (!hasCt) out["Content-Type"] = "text/x-gwt-rpc; charset=utf-8";
  }
  return out;
}

const METHOD_LABELS: Record<string, string> = {
  get_projects: "Lấy danh sách đồ án (getProjects — lọc theo projectType)",
  get_classes: "Lấy danh sách lớp giảng dạy",
  get_course_members: "Lấy danh sách SV trong lớp",
  get_courses: "Lấy danh sách học phần",
  get_committees: "Lấy danh sách hội đồng",
  get_program_classes: "Lấy danh sách lớp chương trình",
  get_education_programs: "Lấy chương trình đào tạo",
  get_education_types: "Lấy loại hình đào tạo",
  get_training_systems: "Lấy hệ đào tạo",
  get_departments: "Lấy danh sách đơn vị / khoa",
  get_education_levels: "Lấy bậc đào tạo",
  get_class_types: "Lấy loại lớp",
  get_user: "Lấy thông tin user hiện tại",
  get_menu: "Lấy menu điều hướng",
  get_news: "Lấy tin tức",
  get_project_types: "Lấy loại đồ án",
  get_project_status: "Lấy trạng thái đồ án",
  get_class_status: "Lấy trạng thái lớp",
};

function humanTitle(name: string, rpcMethod?: string): string {
  if (METHOD_LABELS[name]) return METHOD_LABELS[name];
  if (rpcMethod) {
    const spaced = rpcMethod
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^get\s+/i, "Lấy ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function contextBits(ctx: CaptureContext): string[] {
  const bits: string[] = [];
  if (ctx.semester) bits.push(`kỳ ${ctx.semester}`);
  if (ctx.classId) bits.push(`classId ${ctx.classId}`);
  if (ctx.resourceHint) bits.push(`trang ${ctx.resourceHint}`);
  return bits;
}

function buildDescription(tool: {
  name: string;
  method: string;
  url: string;
  captureContext: CaptureContext;
}): string {
  const ctx = tool.captureContext;
  const title = humanTitle(tool.name, ctx.rpcMethod);
  const bits = contextBits(ctx);
  const frozenNote = ctx.frozen
    ? " GWT frozen + x-signature — args không đổi kỳ/class; cần explore lại để đổi ngữ cảnh."
    : "";
  const ctxNote = bits.length ? ` (capture ${bits.join(", ")})` : "";
  const callNote = ctx.frozen
    ? " Gọi không cần args (replay body đã capture)."
    : "";

  if (ctx.rpcMethod) {
    return `${title}${ctxNote}.${callNote}${frozenNote} RPC ${ctx.rpcMethod} → ${stripQuery(tool.url)}`.replace(
      /\s+/g,
      " ",
    ).trim();
  }
  return `${title}${ctxNote}. Replay ${tool.method} ${stripQuery(tool.url)}.${frozenNote}`
    .replace(/\s+/g, " ")
    .trim();
}

function isReadOnly(method: string, rpcMethod?: string, name?: string): boolean {
  if (method === "GET") return true;
  const m = (rpcMethod ?? name ?? "").toLowerCase();
  return m.startsWith("get") || m.startsWith("list") || m.startsWith("find");
}

function buildAnnotations(
  method: ToolDef["method"],
  ctx: CaptureContext,
  title: string,
): ToolAnnotations {
  const readOnly = isReadOnly(method, ctx.rpcMethod);
  return {
    title,
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : method !== "GET",
    idempotentHint: readOnly,
    openWorldHint: true,
  };
}

function buildInputSchema(opts: {
  bindings: ToolDef["argBindings"];
  bodyTemplate: unknown;
  frozen: boolean;
  /** Previous schema — preserve defaults/descriptions across upgradeTools. */
  previous?: Record<string, unknown>;
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const prevProps = (opts.previous?.properties ?? {}) as Record<
    string,
    { type?: string; description?: string; default?: unknown }
  >;

  for (const [arg, binding] of Object.entries(opts.bindings)) {
    const prev = prevProps[arg];
    properties[arg] = {
      type: prev?.type ?? "string",
      description:
        prev?.description ??
        `${binding.in === "path" ? "Path" : binding.in === "query" ? "Query" : "Body"} param \`${binding.key}\` (bound vào request).`,
      ...(prev?.default !== undefined ? { default: prev.default } : {}),
    };
  }

  if (opts.frozen || isGwtRpcBody(opts.bodyTemplate)) {
    // Do not expose semester/classId as writable inputs — body is signature-bound.
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
      description:
        "Không có input ghi được: GWT body + x-signature đã đóng băng theo capture. Đổi kỳ/class bằng explore lại.",
    };
  }

  if (typeof opts.bodyTemplate === "string" || opts.bodyTemplate != null) {
    const prevBody = prevProps.body;
    properties.body = {
      type: prevBody?.type ?? "string",
      description:
        prevBody?.description ??
        "Optional full request body override. Đổi body có thể phá auth/signature.",
      ...(prevBody?.default !== undefined ? { default: prevBody.default } : {}),
    };
  }

  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties:
      typeof opts.previous?.additionalProperties === "boolean"
        ? opts.previous.additionalProperties
        : false,
  };
}

/**
 * Enrich a ToolDef with title, business description, schemas, annotations, captureContext.
 * Safe to call repeatedly (idempotent upgrade).
 */
export function enrichTool(
  tool: ToolDef,
  opts?: { resourceHint?: string },
): ToolDef {
  const ctx = buildCaptureContext({
    body: tool.bodyTemplate,
    rpcService: tool.captureContext?.rpcService,
    rpcMethod: tool.captureContext?.rpcMethod,
    resourceHint:
      opts?.resourceHint ?? tool.captureContext?.resourceHint,
    frozen: tool.captureContext?.frozen,
  });

  // Preserve semester/classId/projectType if already set and not re-extractable
  const captureContext: CaptureContext = {
    ...ctx,
    semester: ctx.semester ?? tool.captureContext?.semester,
    classId: ctx.classId ?? tool.captureContext?.classId,
    projectType: ctx.projectType ?? tool.captureContext?.projectType,
  };

  const title =
    tool.title ??
    tool.annotations?.title ??
    humanTitle(tool.name, captureContext.rpcMethod);

  const frozen = Boolean(captureContext.frozen);
  const inputSchema = buildInputSchema({
    bindings: frozen ? {} : (tool.argBindings ?? {}),
    bodyTemplate: tool.bodyTemplate,
    frozen,
    previous: tool.inputSchema as Record<string, unknown> | undefined,
  });

  const description = buildDescription({
    name: tool.name,
    method: tool.method,
    url: tool.url,
    captureContext,
  });

  return {
    ...tool,
    title,
    description,
    inputSchema,
    outputSchema:
      tool.outputSchema && Object.keys(tool.outputSchema).length > 0
        ? tool.outputSchema
        : DEFAULT_REPLAY_OUTPUT_SCHEMA,
    annotations: buildAnnotations(tool.method, captureContext, title),
    captureContext,
    argBindings: frozen ? {} : (tool.argBindings ?? {}),
  };
}

/** Backfill / upgrade a list of tools in place semantics (returns new array). */
export function upgradeTools(tools: ToolDef[]): ToolDef[] {
  return tools.map((t) => enrichTool(t));
}

export function candidateToTool(candidate: ApiCandidate): ToolDef {
  const bindings = inferQueryBindings(candidate.url);
  const rpc =
    (candidate.rpcService && candidate.rpcMethod
      ? { service: candidate.rpcService, method: candidate.rpcMethod }
      : null) ?? parseGwtRpc(candidate.requestBodySample);

  const bodyTemplate = candidate.requestBodySample;
  const name = toolNameFromCandidate(candidate);
  const frozen = Boolean(rpc) || isGwtRpcBody(bodyTemplate);

  const base: ToolDef = {
    name,
    description: "",
    method: candidate.method,
    url: stripQuery(candidate.url),
    inputSchema: { type: "object", properties: {} },
    outputSchema: DEFAULT_REPLAY_OUTPUT_SCHEMA,
    annotations: {},
    captureContext: buildCaptureContext({
      body: bodyTemplate,
      rpcService: rpc?.service ?? candidate.rpcService,
      rpcMethod: rpc?.method ?? candidate.rpcMethod,
      resourceHint: candidate.resourceHint,
      frozen,
    }),
    argBindings: frozen ? {} : bindings,
    headers: ensureGwtHeaders(candidate.requestHeaders ?? {}, bodyTemplate),
    bodyTemplate,
    approved: true,
  };

  return enrichTool(base, { resourceHint: candidate.resourceHint });
}

export function toolsFromCandidates(
  candidates: ApiCandidate[],
  ids?: string[],
): ToolDef[] {
  const selected = ids?.length
    ? candidates.filter((c) => ids.includes(c.id))
    : candidates;
  const tools = selected.map(candidateToTool);
  const seen = new Set<string>();
  return tools.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

export function mergeTools(existing: ToolDef[], incoming: ToolDef[]): ToolDef[] {
  const map = new Map(existing.map((t) => [t.name, t]));
  for (const t of incoming) map.set(t.name, upgradeTools([t])[0]!);
  return upgradeTools([...map.values()]);
}
