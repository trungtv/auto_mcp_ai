import type { AuthSnapshot, ToolDef } from "@auto-mcp/shared";

export class AuthExpiredError extends Error {
  constructor(message = "Authentication expired") {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export class ReplayUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayUrlError";
  }
}

export type ReplayOpts = {
  /** Required site origin — tool.url must match exactly. */
  allowedOrigin: string;
  /** Drop baked Authorization on the tool (browser replay supplies a fresh Bearer). */
  stripToolAuthorization?: boolean;
  /** Playwright context already sends cookies — do not set Cookie header. */
  omitCookieHeader?: boolean;
};

function assertAllowedUrl(toolUrl: string, allowedOrigin: string): URL {
  let url: URL;
  let allowed: URL;
  try {
    url = new URL(toolUrl);
    allowed = new URL(allowedOrigin);
  } catch {
    throw new ReplayUrlError("Invalid tool URL or allowedOrigin");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ReplayUrlError(`Unsupported URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new ReplayUrlError("Tool URL must not contain credentials");
  }
  if (url.origin !== allowed.origin) {
    throw new ReplayUrlError(
      `Tool URL origin ${url.origin} is not allowed (expected ${allowed.origin})`,
    );
  }
  return url;
}

/** Validate tool.url against site.baseUrl (approve / upsert). */
export function assertToolUrlAllowed(
  toolUrl: string,
  siteBaseUrl: string,
): void {
  assertAllowedUrl(toolUrl, siteBaseUrl);
}

function cookieHeader(snapshot: AuthSnapshot, url: string): string {
  const host = new URL(url).hostname;
  return snapshot.cookies
    .filter((c) => {
      const domain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
      return host === domain || host.endsWith(`.${domain}`) || host.endsWith(domain);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function headersForToolOrigin(auth: AuthSnapshot, url: URL): Record<string, string> {
  const byOrigin = auth.authHeadersByOrigin ?? {};
  const matched = byOrigin[url.origin];
  if (matched && Object.keys(matched).length > 0) return { ...matched };
  const sameAuthOrigin =
    Boolean(auth.origin) && new URL(auth.origin).origin === url.origin;
  return sameAuthOrigin ? { ...(auth.authHeaders ?? {}) } : {};
}

function stripAuthorization(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Collapse case-variant duplicates (Content-Type + content-type).
 * Undici sends both; Flask/Superset then rejects the body as "Request is not JSON".
 */
export function normalizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const byLower = new Map<string, { name: string; value: string }>();
  for (const [name, value] of Object.entries(headers)) {
    byLower.set(name.toLowerCase(), { name, value });
  }
  const out: Record<string, string> = {};
  for (const { name, value } of byLower.values()) {
    out[name] = value;
  }
  return out;
}

function headerGet(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function headerSet(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) delete headers[k];
  }
  headers[name] = value;
}

export type PreparedReplay = {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

/** Build method/url/headers/body for HTTP or browser replay. */
export function prepareReplay(
  tool: ToolDef,
  args: Record<string, unknown>,
  auth: AuthSnapshot,
  opts: ReplayOpts,
): PreparedReplay {
  let urlHref = tool.url;
  for (const [argName, binding] of Object.entries(tool.argBindings ?? {})) {
    if (binding.in !== "path") continue;
    const value = args[argName];
    if (value === undefined || value === null) continue;
    const token = `{${binding.key}}`;
    if (!urlHref.includes(token)) continue;
    urlHref = urlHref.split(token).join(encodeURIComponent(String(value)));
  }

  const url = assertAllowedUrl(urlHref, opts.allowedOrigin);

  for (const [argName, binding] of Object.entries(tool.argBindings ?? {})) {
    const value = args[argName];
    if (value === undefined || value === null) continue;
    const str = String(value);
    if (binding.in === "query") {
      url.searchParams.set(binding.key, str);
    }
  }

  const toolHeaders = opts.stripToolAuthorization
    ? stripAuthorization(tool.headers ?? {})
    : { ...(tool.headers ?? {}) };

  const headers: Record<string, string> = normalizeHeaders({
    Accept: "*/*",
    ...headersForToolOrigin(auth, url),
    ...toolHeaders,
  });

  if (!headerGet(headers, "Origin")) {
    headerSet(headers, "Origin", url.origin);
  }
  if (!headerGet(headers, "Referer")) {
    headerSet(headers, "Referer", `${url.origin}/`);
  }

  if (!opts.omitCookieHeader) {
    const cookie = cookieHeader(auth, url.toString());
    if (cookie) headerSet(headers, "Cookie", cookie);
  }

  let body: string | undefined;
  if (tool.method !== "GET" && tool.method !== "DELETE") {
    if (typeof args.body === "string") {
      body = args.body;
      if (!headerGet(headers, "Content-Type")) {
        headerSet(headers, "Content-Type", "text/x-gwt-rpc; charset=utf-8");
      }
    } else if (typeof tool.bodyTemplate === "string") {
      body = tool.bodyTemplate;
      if (!headerGet(headers, "Content-Type")) {
        headerSet(headers, "Content-Type", "text/x-gwt-rpc; charset=utf-8");
      }
    } else {
      let payload: unknown = tool.bodyTemplate ?? {};
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        payload = { ...(payload as Record<string, unknown>) };
        for (const [argName, binding] of Object.entries(tool.argBindings ?? {})) {
          if (binding.in === "body" && args[argName] !== undefined) {
            (payload as Record<string, unknown>)[binding.key] = args[argName];
          }
        }
        for (const [k, v] of Object.entries(args)) {
          if (k === "body") continue;
          const binding = tool.argBindings?.[k];
          if (!binding || binding.in === "body") {
            (payload as Record<string, unknown>)[binding?.key ?? k] = v;
          }
        }
      }
      body = JSON.stringify(payload);
      if (!headerGet(headers, "Content-Type")) {
        headerSet(headers, "Content-Type", "application/json");
      } else {
        // Ensure a single canonical Content-Type after normalize.
        headerSet(headers, "Content-Type", headerGet(headers, "Content-Type")!);
      }
    }
  }

  for (const [argName, binding] of Object.entries(tool.argBindings ?? {})) {
    if (binding.in === "header" && args[argName] !== undefined) {
      headerSet(headers, binding.key, String(args[argName]));
    }
  }

  return { url, method: tool.method, headers: normalizeHeaders(headers), body };
}

export function isAuthExpiredStatus(status: number, location = ""): boolean {
  return (
    status === 401 ||
    status === 403 ||
    (status >= 300 && status < 400 && /login|sso|cas|signin/i.test(location))
  );
}

export function parseReplayBody(text: string): unknown {
  let responseBody: unknown = text;
  const trimmed = text.trimStart();
  if (
    trimmed.length > 0 &&
    !trimmed.startsWith("//OK") &&
    !trimmed.startsWith("//EX") &&
    (trimmed.startsWith("{") || trimmed.startsWith("["))
  ) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
  }
  return responseBody;
}

export async function replayTool(
  tool: ToolDef,
  args: Record<string, unknown>,
  auth: AuthSnapshot,
  opts: ReplayOpts,
): Promise<{ status: number; body: unknown }> {
  const prepared = prepareReplay(tool, args, auth, opts);
  const res = await fetch(prepared.url.toString(), {
    method: prepared.method,
    headers: prepared.headers,
    body: prepared.body,
    redirect: "manual",
  });

  const location = res.headers.get("location") ?? "";
  if (isAuthExpiredStatus(res.status, location)) {
    throw new AuthExpiredError(`HTTP ${res.status} — session likely expired`);
  }

  const text = await res.text();
  return { status: res.status, body: parseReplayBody(text) };
}
