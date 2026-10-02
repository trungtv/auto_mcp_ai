import {
  extractClassId,
  extractSemester,
  isGwtRpcBody,
  parseGwtRpc,
  type ApiCandidate,
  type CaptureContext,
  type ToolAnnotations,
  type ToolDef,
} from "@auto-mcp/shared";

export type PipelineStatus = "candidate" | "proposed" | "approved";

export type CatalogRow = {
  key: string;
  status: PipelineStatus;
  name: string;
  title?: string;
  method: ToolDef["method"];
  url: string;
  description: string;
  rpcService?: string;
  rpcMethod?: string;
  semester?: string;
  classId?: string;
  isGwt: boolean;
  frozen?: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  captureContext?: CaptureContext;
  argBindings: ToolDef["argBindings"];
  headers: Record<string, string>;
  bodyTemplate?: unknown;
  candidateId?: string;
  tool?: ToolDef;
  candidate?: ApiCandidate;
};

const REDACT_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-signature",
  "proxy-authorization",
]);

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.slice(0, 80) || u.host;
  } catch {
    return url.slice(0, 80);
  }
}

export function gwtMeta(body: unknown, rpcService?: string, rpcMethod?: string) {
  const parsed = parseGwtRpc(body);
  return {
    service: rpcService ?? parsed?.service,
    method: rpcMethod ?? parsed?.method,
    semester: extractSemester(body),
    classId: extractClassId(body),
    isGwt: Boolean(rpcMethod || parsed || isGwtRpcBody(body)),
  };
}

export function redactHeaders(
  headers: Record<string, string>,
): Array<{ key: string; value: string; redacted: boolean }> {
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const redacted = REDACT_KEYS.has(key.toLowerCase());
      return {
        key,
        value: redacted ? `••• (${value.length} chars)` : value,
        redacted,
      };
    });
}

export function bodyPreview(body: unknown, max = 1200): string {
  if (body === undefined || body === null) return "";
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length} chars)`;
}

function candidateName(c: ApiCandidate): string {
  const rpc = c.rpcMethod ?? parseGwtRpc(c.requestBodySample)?.method;
  if (rpc) {
    return rpc
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .slice(0, 64);
  }
  return shortUrl(c.url).replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 48) || c.id.slice(0, 8);
}

function rowFromTool(t: ToolDef, status: "approved" | "proposed"): CatalogRow {
  const ctx = t.captureContext ?? {};
  const rpc = parseGwtRpc(t.bodyTemplate);
  const meta = gwtMeta(t.bodyTemplate, ctx.rpcService, ctx.rpcMethod);
  return {
    key: `${status}:${t.name}`,
    status,
    name: t.name,
    title: t.title ?? t.annotations?.title,
    method: t.method,
    url: t.url,
    description: t.description,
    rpcService: ctx.rpcService ?? rpc?.service ?? meta.service,
    rpcMethod: ctx.rpcMethod ?? rpc?.method ?? meta.method,
    semester: ctx.semester ?? meta.semester,
    classId: ctx.classId ?? meta.classId,
    isGwt: meta.isGwt,
    frozen: ctx.frozen ?? meta.isGwt,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    outputSchema: t.outputSchema,
    annotations: t.annotations,
    captureContext: ctx,
    argBindings: t.argBindings ?? {},
    headers: t.headers ?? {},
    bodyTemplate: t.bodyTemplate,
    tool: t,
  };
}

export function rowsFromSite(site: {
  candidates: ApiCandidate[];
  proposedTools: ToolDef[];
  tools: ToolDef[];
}): CatalogRow[] {
  const approvedNames = new Set(site.tools.map((t) => t.name));
  const rows: CatalogRow[] = [];

  for (const t of site.tools) {
    rows.push(rowFromTool(t, "approved"));
  }

  for (const t of site.proposedTools) {
    if (approvedNames.has(t.name)) continue;
    rows.push(rowFromTool(t, "proposed"));
  }

  for (const c of site.candidates) {
    const name = candidateName(c);
    if (approvedNames.has(name)) continue;
    const meta = gwtMeta(c.requestBodySample, c.rpcService, c.rpcMethod);
    rows.push({
      key: `candidate:${c.id}`,
      status: "candidate",
      name,
      method: c.method,
      url: c.url,
      description: meta.method
        ? `Captured ${meta.service ?? ""}.${meta.method}`.replace(/\.$/, "")
        : `Captured ${c.method} ${shortUrl(c.url)}`,
      rpcService: meta.service,
      rpcMethod: meta.method,
      semester: meta.semester,
      classId: meta.classId,
      isGwt: meta.isGwt,
      frozen: meta.isGwt,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      argBindings: {},
      headers: c.requestHeaders ?? {},
      bodyTemplate: c.requestBodySample,
      candidateId: c.id,
      candidate: c,
      captureContext: {
        rpcService: meta.service,
        rpcMethod: meta.method,
        semester: meta.semester,
        classId: meta.classId,
        resourceHint: c.resourceHint,
        frozen: meta.isGwt,
      },
    });
  }

  return rows;
}

export function filterRows(
  rows: CatalogRow[],
  opts: {
    segment: "all" | PipelineStatus;
    method: string | "all";
    query: string;
  },
): CatalogRow[] {
  const q = opts.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (opts.segment !== "all" && r.status !== opts.segment) return false;
    if (opts.method !== "all" && r.method !== opts.method) return false;
    if (!q) return true;
    const hay = [
      r.name,
      r.title ?? "",
      r.url,
      r.description,
      r.rpcMethod ?? "",
      r.rpcService ?? "",
      r.semester ?? "",
      r.classId ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
