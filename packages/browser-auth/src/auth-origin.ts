import type { AuthSnapshot } from "@auto-mcp/shared";
import { extractAuthHeaders } from "./api-capture.js";

export type AuthHeadersByOrigin = Record<string, Record<string, string>>;

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Merge extracted auth headers into the per-origin store. */
export function recordAuthHeaders(
  store: AuthHeadersByOrigin,
  url: string,
  headers: Record<string, string>,
): void {
  const extracted = extractAuthHeaders(headers);
  if (Object.keys(extracted).length === 0) return;
  const origin = originOf(url);
  if (!origin) return;
  store[origin] = { ...(store[origin] ?? {}), ...extracted };
}

export function authHeadersForOrigin(
  snapshot: Pick<AuthSnapshot, "origin" | "authHeaders" | "authHeadersByOrigin">,
  urlOrOrigin: string,
): Record<string, string> {
  const origin = originOf(urlOrOrigin) ?? urlOrOrigin;
  const byOrigin = snapshot.authHeadersByOrigin ?? {};
  const matched = byOrigin[origin];
  if (matched && Object.keys(matched).length > 0) return { ...matched };
  try {
    if (snapshot.origin && new URL(snapshot.origin).origin === origin) {
      return { ...(snapshot.authHeaders ?? {}) };
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function snapshotAuthFields(
  store: AuthHeadersByOrigin,
  baseOrigin: string,
): {
  authHeaders: Record<string, string>;
  authHeadersByOrigin: AuthHeadersByOrigin;
} {
  return {
    authHeadersByOrigin: { ...store },
    authHeaders: { ...(store[baseOrigin] ?? {}) },
  };
}

export function stripAuthorization(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") continue;
    out[k] = v;
  }
  return out;
}
