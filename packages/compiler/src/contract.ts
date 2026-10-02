import { candidateToTool } from "@auto-mcp/mcp-generator";
import {
  isGwtRpcBody,
  type ApiCandidate,
  type EndpointIr,
  type EndpointIrParam,
  type IrContractResult,
  type IrMutationResult,
  type ToolDef,
} from "@auto-mcp/shared";
import { latestCandidateForIr } from "./compiler.js";

export type ReplayLike = (
  tool: ToolDef,
  args: Record<string, unknown>,
) => Promise<{ status: number; body: unknown }>;

function isFrozen(tool: ToolDef, candidate?: ApiCandidate): boolean {
  return (
    Boolean(tool.captureContext?.frozen) ||
    isGwtRpcBody(tool.bodyTemplate) ||
    isGwtRpcBody(candidate?.requestBodySample)
  );
}

function isGwt(tool: ToolDef, candidate?: ApiCandidate): boolean {
  return (
    isGwtRpcBody(tool.bodyTemplate) ||
    isGwtRpcBody(candidate?.requestBodySample) ||
    Boolean(tool.captureContext?.rpcMethod) ||
    Boolean(candidate?.rpcMethod)
  );
}

export function extractBodyTopKeys(body: unknown): string[] {
  if (body == null) return [];
  if (typeof body === "string") return [];
  if (typeof body === "object" && !Array.isArray(body)) {
    return Object.keys(body as Record<string, unknown>).slice(0, 40);
  }
  if (Array.isArray(body) && body[0] && typeof body[0] === "object") {
    return Object.keys(body[0] as Record<string, unknown>).slice(0, 40);
  }
  return [];
}

export function argsFromIrSamples(ir: EndpointIr): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const p of ir.params) {
    const sample = p.samples[0];
    if (sample === undefined) continue;
    const arg = p.name.replace(/[^a-zA-Z0-9_]/g, "_");
    args[arg] = sample;
  }
  return args;
}

export function firstMutableQueryParam(
  ir: EndpointIr,
): EndpointIrParam | undefined {
  return ir.params.find((p) => p.in === "query" && p.samples.length >= 2);
}

function httpOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function gwtOk(status: number, body: unknown): { ok: boolean; note?: string } {
  if (!httpOk(status)) return { ok: false, note: `http_${status}` };
  if (typeof body !== "string") {
    return { ok: false, note: "gwt_body_not_string" };
  }
  const trimmed = body.trimStart();
  if (trimmed.startsWith("//EX")) return { ok: false, note: "gwt_exception" };
  if (!trimmed.startsWith("//OK")) return { ok: false, note: "gwt_not_ok" };
  return { ok: true };
}

function jsonContract(
  ir: EndpointIr,
  status: number,
  body: unknown,
): Omit<IrContractResult, "at"> {
  if (!httpOk(status)) {
    return {
      ok: false,
      status,
      matchedKeys: [],
      missingKeys: [...ir.responseKeys],
      note: `http_${status}`,
    };
  }
  if (ir.responseKeys.length === 0) {
    return {
      ok: false,
      status,
      matchedKeys: [],
      missingKeys: [],
      note: "incomplete_schema",
    };
  }
  const top = extractBodyTopKeys(body);
  const matchedKeys = ir.responseKeys.filter((k) => top.includes(k));
  const missingKeys = ir.responseKeys.filter((k) => !top.includes(k));
  if (matchedKeys.length < 1) {
    return {
      ok: false,
      status,
      matchedKeys,
      missingKeys,
      note: "no_key_overlap",
    };
  }
  return { ok: true, status, matchedKeys, missingKeys };
}

export function resolveToolForIr(
  ir: EndpointIr,
  tools: ToolDef[],
  candidates: ApiCandidate[],
): { tool: ToolDef; candidate?: ApiCandidate } {
  if (!ir.compiledPrimitive) {
    throw new Error(
      `Endpoint IR \`${ir.id}\` is not compiled. compile_endpoints confirm:true first.`,
    );
  }
  const existing = tools.find((t) => t.name === ir.compiledPrimitive);
  const candidate = latestCandidateForIr(ir, candidates);
  const tool = existing ?? (candidate ? candidateToTool(candidate) : undefined);
  if (!tool) {
    throw new Error(
      `No primitive \`${ir.compiledPrimitive}\` and no candidate for IR \`${ir.id}\`.`,
    );
  }
  return { tool, candidate };
}

export async function testEndpointContract(opts: {
  ir: EndpointIr;
  tool: ToolDef;
  candidate?: ApiCandidate;
  replay: ReplayLike;
}): Promise<IrContractResult> {
  const frozen = isFrozen(opts.tool, opts.candidate);
  const gwt = isGwt(opts.tool, opts.candidate);
  const args = frozen || gwt ? {} : argsFromIrSamples(opts.ir);
  const { status, body } = await opts.replay(opts.tool, args);
  const at = new Date().toISOString();
  if (gwt) {
    const g = gwtOk(status, body);
    return {
      at,
      ok: g.ok,
      status,
      matchedKeys: [],
      missingKeys: [],
      ...(g.note ? { note: g.note } : {}),
    };
  }
  return { at, ...jsonContract(opts.ir, status, body) };
}

export async function testEndpointMutation(opts: {
  ir: EndpointIr;
  tool: ToolDef;
  candidate?: ApiCandidate;
  replay: ReplayLike;
}): Promise<IrMutationResult> {
  if (opts.ir.kind !== "data_api") {
    throw new Error(
      `Mutation requires kind=data_api (got ${opts.ir.kind}) for IR \`${opts.ir.id}\`.`,
    );
  }
  if (isFrozen(opts.tool, opts.candidate) || isGwt(opts.tool, opts.candidate)) {
    throw new Error(
      `Mutation is not supported for frozen/GWT IR \`${opts.ir.id}\`.`,
    );
  }
  const param = firstMutableQueryParam(opts.ir);
  if (!param || param.samples.length < 2) {
    throw new Error(
      `Mutation needs a query param with ≥2 samples on IR \`${opts.ir.id}\` — explore again with a different query.`,
    );
  }
  const from = param.samples[0]!;
  const to = param.samples[1]!;
  const arg = param.name.replace(/[^a-zA-Z0-9_]/g, "_");
  const args = { ...argsFromIrSamples(opts.ir), [arg]: to };
  const { status, body } = await opts.replay(opts.tool, args);
  const at = new Date().toISOString();
  const contract = jsonContract(opts.ir, status, body);
  return {
    at,
    ok: contract.ok,
    param: param.name,
    from,
    to,
    status,
    ...(contract.note ? { note: contract.note } : {}),
  };
}
