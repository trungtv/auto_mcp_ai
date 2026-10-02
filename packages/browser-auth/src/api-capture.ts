import {
  candidateKey,
  parseGwtRpc,
  truncateGwtAware,
  GWT_BODY_LIMIT,
  type ApiCandidate,
} from "@auto-mcp/shared";
import { createHash } from "node:crypto";

const AUTH_HEADER_KEYS = new Set([
  "authorization",
  "x-csrf-token",
  "x-xsrf-token",
  "x-requested-with",
  "x-access-token",
  "x-auth-token",
]);

const REPLAY_HEADER_KEYS = new Set([
  ...AUTH_HEADER_KEYS,
  "content-type",
  "accept",
  "referer",
  "user-agent",
  "x-gwt-permutation",
  "x-gwt-module-base",
  /** Some GWT-RPC sites sign each body; required for replay when present. */
  "x-signature",
]);

const GWT_BODY_MAX = 16_384;
/** Cap stored GWT/API response samples (GWT-aware to keep string table). */
const GWT_RESPONSE_MAX = GWT_BODY_LIMIT;

/**
 * Prefer text for GWT-RPC (`//OK` / `//EX`); otherwise JSON when content-type says so.
 * GWT often advertises application/json but body is not valid JSON.
 */
export async function sampleResponseBody(opts: {
  contentType: string;
  text: () => Promise<string>;
  json?: () => Promise<unknown>;
}): Promise<unknown> {
  let text: string | undefined;
  try {
    text = await opts.text();
  } catch {
    return undefined;
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("//OK") || trimmed.startsWith("//EX")) {
    return truncateGwtAware(text, GWT_RESPONSE_MAX).text;
  }
  if (opts.contentType.includes("json") && opts.json) {
    try {
      return await opts.json();
    } catch {
      return text.length > GWT_RESPONSE_MAX
        ? text.slice(0, GWT_RESPONSE_MAX)
        : text;
    }
  }
  if (text.length === 0) return undefined;
  return text.length > GWT_RESPONSE_MAX
    ? text.slice(0, GWT_RESPONSE_MAX)
    : text;
}

export function extractAuthHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (AUTH_HEADER_KEYS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/** Headers needed to replay the call (auth + GWT). */
export function extractReplayHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (REPLAY_HEADER_KEYS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

export function isApiRequest(url: string, resourceType: string): boolean {
  if (resourceType === "xhr" || resourceType === "fetch") return true;
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico|map)(\?|$)/i.test(url)) {
    return false;
  }
  if (
    /\/api\/|graphql|\.json(\?|$)|\/rest\/|soicteducationteacher/i.test(url)
  ) {
    return true;
  }
  return false;
}

export function sampleRequestBody(
  postData: string | null,
  postDataBuffer?: Buffer | null,
): unknown {
  // Prefer buffer decoded as UTF-8 when Playwright string length disagrees (non-ASCII).
  let raw = postData ?? undefined;
  if (postDataBuffer && postDataBuffer.length) {
    const fromBuf = postDataBuffer.toString("utf8");
    if (!raw || fromBuf.length !== raw.length || fromBuf !== raw) {
      raw = fromBuf;
    }
  }
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw.length > GWT_BODY_MAX ? raw.slice(0, GWT_BODY_MAX) : raw;
  }
}

export function buildApiCandidate(opts: {
  method: string;
  url: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestBodySample?: unknown;
  responseBodySample?: unknown;
  contentType?: string;
  resourceHint?: string;
}): ApiCandidate {
  const rpc = parseGwtRpc(opts.requestBodySample);
  const method = opts.method.toUpperCase() as ApiCandidate["method"];
  const draft: ApiCandidate = {
    id: "pending",
    method,
    url: opts.url,
    status: opts.status,
    requestHeaders: opts.requestHeaders,
    requestBodySample: opts.requestBodySample,
    responseBodySample: opts.responseBodySample,
    contentType: opts.contentType,
    resourceHint: opts.resourceHint,
    rpcService: rpc?.service,
    rpcMethod: rpc?.method,
    discoveredAt: new Date().toISOString(),
  };
  const key = candidateKey(draft);
  draft.id = createHash("sha256").update(key).digest("base64url").slice(0, 24);
  return draft;
}
