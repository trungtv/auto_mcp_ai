import { GWT_BODY_LIMIT } from "@auto-mcp/shared";
import { genericHttpHandler } from "./generic-http.js";
import type { FormatHandler } from "../types.js";

const JSON_PARSE_BYTE_LIMIT = 4 * 1024 * 1024;

type GenericJsonOptions = { unwrap?: string[] };

function parseGenericJsonOptions(
  opts: Record<string, unknown> | undefined,
): GenericJsonOptions {
  if (!opts) return {};
  const unwrap = opts.unwrap;
  if (unwrap === undefined) return {};
  if (!Array.isArray(unwrap) || unwrap.length > 8) {
    throw new Error("formatOptions.unwrap must be an array of at most 8 strings");
  }
  for (const seg of unwrap) {
    if (typeof seg !== "string" || !seg.trim()) {
      throw new Error("formatOptions.unwrap segments must be non-empty strings");
    }
  }
  return { unwrap: unwrap as string[] };
}

function bodyText(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

function isOk(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  if (typeof body === "string" && body.trimStart().startsWith("//EX")) {
    return false;
  }
  return true;
}

function unwrapSegments(
  value: unknown,
  segments: string[],
): unknown {
  let cur: unknown = value;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return cur;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export const genericJsonHandler: FormatHandler = {
  id: "generic.json",
  validateOptions(opts) {
    parseGenericJsonOptions(opts);
  },
  format(ctx) {
    const status = Number(ctx.meta.status ?? 0);
    const raw = bodyText(ctx.body);
    const ok = isOk(status, ctx.body);
    const includeRaw = ctx.includeRaw === true;

    if (raw.length > JSON_PARSE_BYTE_LIMIT) {
      const http = genericHttpHandler.format(ctx);
      return {
        ...http,
        structuredContent: {
          ...(http.structuredContent ?? {}),
          parseSkipped: true,
          parseSkipReason: `body exceeds ${JSON_PARSE_BYTE_LIMIT} bytes`,
          format: ctx.format,
        },
      };
    }

    let parsed: unknown;
    let parseError: string | undefined;
    try {
      if (typeof ctx.body === "object" && ctx.body !== null) {
        parsed = ctx.body;
      } else {
        parsed = JSON.parse(raw);
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      parsed = undefined;
    }

    const opts = parseGenericJsonOptions(ctx.formatOptions);
    let data: unknown = parsed;
    if (!parseError && opts.unwrap?.length) {
      data = unwrapSegments(parsed, opts.unwrap);
    }

    const structuredContent: Record<string, unknown> = {
      ...ctx.meta,
      ok: ok && !parseError,
      status,
      format: ctx.format,
      data,
      byteLength: raw.length,
    };
    if (parseError) {
      structuredContent.parseError = parseError;
    }
    if (includeRaw) {
      structuredContent.rawBody =
        raw.length > GWT_BODY_LIMIT ? raw.slice(0, GWT_BODY_LIMIT) : raw;
      structuredContent.rawTruncated = raw.length > GWT_BODY_LIMIT;
    }

    const text =
      parseError
        ? `JSON parse failed: ${parseError}`
        : `HTTP ${status} · json ok · ${typeof data === "object" && data !== null ? Object.keys(data as object).length : 1} top-level field(s)`;

    return {
      content: [{ type: "text", text }],
      structuredContent,
      ...(ok && !parseError ? {} : { isError: true }),
    };
  },
};
