import { createHash, randomUUID } from "node:crypto";
import { candidateToTool, enrichTool } from "@auto-mcp/mcp-generator";
import {
  candidateKey,
  isGwtRpcBody,
  outputSchemaFromResponseKeys,
  parseGwtRpc,
  snakeCaseRpcMethod,
  type ApiCandidate,
  type EndpointIr,
  type EndpointIrKind,
  type EndpointIrParam,
  type ObservedAction,
  type ObservedUi,
  type ToolDef,
} from "@auto-mcp/shared";

export const MAX_OBSERVED_ACTIONS = 2000;

const ASSET_RE = /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico|map)(\?|$)/i;
const API_PATH_RE = /\/api\/|graphql|\.json(\?|$)|\/rest\/|soicteducationteacher/i;
const SECRET_KEY_RE = /pass|secret|token|authorization|pwd|signature|cookie/i;

function irId(key: string): string {
  return createHash("sha256").update(key).digest("base64url").slice(0, 24);
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

function extractQueryEntries(url: string): Array<{ name: string; value: string }> {
  try {
    const u = new URL(url);
    return [...u.searchParams.entries()]
      .filter(([name]) => !SECRET_KEY_RE.test(name))
      .map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function extractBodyKeys(body: unknown): string[] {
  if (isGwtRpcBody(body)) return [];
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return Object.keys(body as Record<string, unknown>).filter(
      (k) => !SECRET_KEY_RE.test(k),
    );
  }
  return [];
}

function extractTopKeys(body: unknown): string[] {
  if (body == null) return [];
  if (isGwtRpcBody(body) || typeof body === "string") {
    const rpc = parseGwtRpc(body);
    return rpc ? [rpc.method] : [];
  }
  if (typeof body === "object" && !Array.isArray(body)) {
    return Object.keys(body as Record<string, unknown>).slice(0, 24);
  }
  if (Array.isArray(body) && body[0] && typeof body[0] === "object") {
    return Object.keys(body[0] as Record<string, unknown>).slice(0, 24);
  }
  return [];
}

function inferType(samples: string[]): EndpointIrParam["inferredType"] {
  if (samples.length === 0) return "string";
  if (samples.every((s) => s === "true" || s === "false")) return "boolean";
  if (samples.every((s) => /^-?\d+(\.\d+)?$/.test(s))) return "number";
  if (samples.every((s) => s.startsWith("{") || s.startsWith("["))) return "object";
  return "string";
}

function jsonOrGwt(c: Pick<ApiCandidate, "contentType" | "requestBodySample" | "responseBodySample">): boolean {
  const ct = c.contentType ?? "";
  if (ct.includes("json") || ct.includes("gwt")) return true;
  if (isGwtRpcBody(c.requestBodySample) || isGwtRpcBody(c.responseBodySample)) {
    return true;
  }
  return (
    c.responseBodySample != null &&
    typeof c.responseBodySample === "object"
  );
}

/** Same URL filters as `isApiRequest`, then JSON/GWT + method → data/action. */
export function classifyKind(
  c: Pick<
    ApiCandidate,
    | "method"
    | "url"
    | "contentType"
    | "requestBodySample"
    | "responseBodySample"
    | "resourceHint"
  >,
): EndpointIrKind {
  if (ASSET_RE.test(c.url)) return "other";
  const xhr = c.resourceHint === "xhr" || c.resourceHint === "fetch";
  const pathApi = API_PATH_RE.test(c.url);
  const typed = jsonOrGwt(c);
  if (!pathApi && !typed && !xhr) return "other";
  if (!pathApi && !typed) return "other";
  if (c.method === "GET") return "data_api";
  return "action_api";
}

export function suggestedNameFromCandidate(c: ApiCandidate): string {
  const rpc =
    c.rpcMethod ?? parseGwtRpc(c.requestBodySample)?.method ?? undefined;
  if (rpc) return snakeCaseRpcMethod(rpc);
  try {
    const u = new URL(c.url);
    const parts = u.pathname
      .split("/")
      .filter(Boolean)
      .map((p) => p.replace(/[^a-zA-Z0-9]/g, "_"))
      .filter(Boolean);
    const base = parts.slice(-3).join("_") || "api";
    return `${c.method.toLowerCase()}_${base}`.slice(0, 64);
  } catch {
    return `${c.method.toLowerCase()}_endpoint`;
  }
}

export function recordObservation(opts: {
  candidate: ApiCandidate;
  ui?: ObservedUi;
  exploreRound?: number;
}): ObservedAction {
  const { candidate, ui, exploreRound } = opts;
  const rpc =
    candidate.rpcMethod ??
    parseGwtRpc(candidate.requestBodySample)?.method ??
    undefined;
  return {
    id: randomUUID(),
    candidateId: candidate.id,
    observedAt: new Date().toISOString(),
    ...(exploreRound != null ? { exploreRound } : {}),
    ...(ui ? { ui } : {}),
    network: {
      method: candidate.method,
      url: candidate.url,
      status: candidate.status,
      contentType: candidate.contentType,
    },
    requestSketch: {
      queryKeys: extractQueryEntries(candidate.url).map((e) => e.name),
      bodyKeys: extractBodyKeys(candidate.requestBodySample),
    },
    responseSketch: {
      topKeys: extractTopKeys(candidate.responseBodySample),
      ...(rpc ? { rpcMethod: rpc } : {}),
    },
  };
}

export function appendObservations(
  existing: ObservedAction[],
  incoming: ObservedAction[],
): ObservedAction[] {
  return [...existing, ...incoming].slice(-MAX_OBSERVED_ACTIONS);
}

function mergeParam(
  map: Map<string, EndpointIrParam>,
  name: string,
  loc: EndpointIrParam["in"],
  sample?: string,
): void {
  const key = `${loc}:${name}`;
  const cur = map.get(key);
  const samples = cur?.samples ?? [];
  if (sample && sample.length > 0 && !samples.includes(sample) && samples.length < 8) {
    samples.push(sample);
  }
  map.set(key, {
    name,
    in: loc,
    samples,
    inferredType: inferType(samples),
  });
}

function absorbCandidateParams(
  map: Map<string, EndpointIrParam>,
  c: ApiCandidate,
): void {
  for (const e of extractQueryEntries(c.url)) {
    mergeParam(map, e.name, "query", e.value);
  }
  for (const k of extractBodyKeys(c.requestBodySample)) {
    const body = c.requestBodySample as Record<string, unknown>;
    const raw = body[k];
    const sample =
      raw == null || typeof raw === "object" ? undefined : String(raw);
    mergeParam(map, k, "body", sample);
  }
}

function absorbActionParams(
  map: Map<string, EndpointIrParam>,
  action: ObservedAction,
): void {
  for (const k of action.requestSketch.queryKeys) {
    mergeParam(map, k, "query");
  }
  for (const k of action.requestSketch.bodyKeys) {
    mergeParam(map, k, "body");
  }
}

export function rebuildIr(
  actions: ObservedAction[],
  candidates: ApiCandidate[],
  previous?: EndpointIr[],
): EndpointIr[] {
  const prevByKey = new Map((previous ?? []).map((e) => [e.key, e]));
  const byKey = new Map<
    string,
    {
      candidates: ApiCandidate[];
      actions: ObservedAction[];
    }
  >();

  for (const c of candidates) {
    const key = candidateKey(c);
    const bucket = byKey.get(key) ?? { candidates: [], actions: [] };
    bucket.candidates.push(c);
    byKey.set(key, bucket);
  }

  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  for (const a of actions) {
    const c = candidateById.get(a.candidateId);
    const key = c
      ? candidateKey(c)
      : `${a.network.method} ${stripQuery(a.network.url)}`;
    const bucket = byKey.get(key) ?? { candidates: [], actions: [] };
    bucket.actions.push(a);
    if (c && !bucket.candidates.some((x) => x.id === c.id)) {
      bucket.candidates.push(c);
    }
    byKey.set(key, bucket);
  }

  const out: EndpointIr[] = [];
  for (const [key, bucket] of byKey) {
    const representative =
      bucket.candidates.at(-1) ??
      ({
        id: "",
        method: bucket.actions[0]!.network.method,
        url: bucket.actions[0]!.network.url,
        requestHeaders: {},
        contentType: bucket.actions[0]!.network.contentType,
      } satisfies ApiCandidate);
    const paramMap = new Map<string, EndpointIrParam>();
    for (const c of bucket.candidates) absorbCandidateParams(paramMap, c);
    for (const a of bucket.actions) absorbActionParams(paramMap, a);
    const responseKeys = [
      ...new Set([
        ...bucket.actions.flatMap((a) => a.responseSketch.topKeys),
        ...bucket.candidates.flatMap((c) => extractTopKeys(c.responseBodySample)),
      ]),
    ].slice(0, 40);
    const prev = prevByKey.get(key);
    const heuristic = suggestedNameFromCandidate(representative);
    out.push({
      id: prev?.id ?? irId(key),
      key,
      method: representative.method,
      urlTemplate: stripQuery(representative.url),
      kind: classifyKind(representative),
      params: [...paramMap.values()],
      responseKeys,
      evidenceActionIds: bucket.actions.map((a) => a.id),
      candidateIds: bucket.candidates.map((c) => c.id),
      suggestedName: prev?.suggestedName ?? heuristic,
      ...(prev?.compiledPrimitive
        ? { compiledPrimitive: prev.compiledPrimitive }
        : {}),
      ...(prev?.lastContract ? { lastContract: prev.lastContract } : {}),
      ...(prev?.lastMutation ? { lastMutation: prev.lastMutation } : {}),
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function latestCandidateForIr(
  ir: EndpointIr,
  candidates: ApiCandidate[],
): ApiCandidate | undefined {
  const set = new Set(ir.candidateIds);
  const matches = candidates.filter((c) => set.has(c.id));
  if (matches.length) return matches.at(-1);
  return candidates.find((c) => candidateKey(c) === ir.key);
}

export function compileEndpoint(
  ir: EndpointIr,
  latestCandidate: ApiCandidate,
): ToolDef {
  if (ir.kind === "other") {
    throw new Error(`Cannot compile IR kind=other: ${ir.key}`);
  }
  const tool = candidateToTool(latestCandidate);
  const bindings: ToolDef["argBindings"] = { ...(tool.argBindings ?? {}) };
  for (const p of ir.params) {
    const arg = p.name.replace(/[^a-zA-Z0-9_]/g, "_");
    bindings[arg] = { in: p.in, key: p.name };
  }
  const frozen = Boolean(tool.captureContext?.frozen);
  const gwt =
    frozen ||
    isGwtRpcBody(tool.bodyTemplate) ||
    isGwtRpcBody(latestCandidate.requestBodySample);
  const fromKeys = gwt
    ? undefined
    : outputSchemaFromResponseKeys(ir.responseKeys);
  return enrichTool({
    ...tool,
    name: ir.suggestedName || tool.name,
    argBindings: frozen ? {} : bindings,
    ...(fromKeys ? { outputSchema: fromKeys } : {}),
    approved: true,
  });
}

export function selectEndpointIr(
  ir: EndpointIr[],
  opts: { endpointIds?: string[]; candidateIds?: string[] },
): EndpointIr[] {
  if (opts.endpointIds?.length) {
    const set = new Set(opts.endpointIds);
    return ir.filter((e) => set.has(e.id));
  }
  if (opts.candidateIds?.length) {
    const set = new Set(opts.candidateIds);
    return ir.filter((e) => e.candidateIds.some((id) => set.has(id)));
  }
  return ir.filter((e) => e.kind !== "other");
}

export function planCompile(opts: {
  ir: EndpointIr[];
  candidates: ApiCandidate[];
  endpointIds?: string[];
  candidateIds?: string[];
}): {
  selected: EndpointIr[];
  skippedOther: EndpointIr[];
  tools: ToolDef[];
} {
  const selectedAll = selectEndpointIr(opts.ir, {
    endpointIds: opts.endpointIds,
    candidateIds: opts.candidateIds,
  });
  const skippedOther = selectedAll.filter((e) => e.kind === "other");
  const selected = selectedAll.filter((e) => e.kind !== "other");
  const tools: ToolDef[] = [];
  const seen = new Set<string>();
  for (const e of selected) {
    const cand = latestCandidateForIr(e, opts.candidates);
    if (!cand) continue;
    const tool = compileEndpoint(e, cand);
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    tools.push(tool);
  }
  return { selected, skippedOther, tools };
}

export function captureToIr(opts: {
  actions: ObservedAction[];
  previousIr: EndpointIr[];
  captured: ApiCandidate[];
  allCandidates: ApiCandidate[];
  ui?: ObservedUi;
  exploreRound?: number;
}): { observedActions: ObservedAction[]; endpointIr: EndpointIr[] } {
  const fresh = opts.captured.map((c) =>
    recordObservation({
      candidate: c,
      ui: opts.ui,
      exploreRound: opts.exploreRound,
    }),
  );
  const observedActions = appendObservations(opts.actions, fresh);
  return {
    observedActions,
    endpointIr: rebuildIr(observedActions, opts.allCandidates, opts.previousIr),
  };
}
