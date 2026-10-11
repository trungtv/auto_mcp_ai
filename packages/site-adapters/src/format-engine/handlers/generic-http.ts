import { GWT_BODY_LIMIT } from "@auto-mcp/shared";
import type { FormatHandler } from "../types.js";
import type { CapabilityResult } from "../../types.js";

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

export const genericHttpHandler: FormatHandler = {
  id: "generic.http",
  validateOptions: () => {},
  format(ctx): CapabilityResult {
    const status = Number(ctx.meta.status ?? 0);
    const raw = bodyText(ctx.body);
    const ok = isOk(status, ctx.body);
    const preview =
      raw.length > 48_000 ? raw.slice(0, 48_000) : raw;
    const includeRaw = ctx.includeRaw === true;
    const structuredContent: Record<string, unknown> = {
      ...ctx.meta,
      ok,
      status,
      bodyPreview: preview,
      truncated: raw.length > 48_000,
      byteLength: raw.length,
      format: ctx.format,
    };
    if (includeRaw) {
      structuredContent.rawBody =
        raw.length > GWT_BODY_LIMIT ? raw.slice(0, GWT_BODY_LIMIT) : raw;
      structuredContent.rawTruncated = raw.length > GWT_BODY_LIMIT;
    }
    return {
      content: [
        {
          type: "text",
          text: `HTTP ${status}\n\n${raw.slice(0, 2048)}`,
        },
      ],
      structuredContent,
      ...(ok ? {} : { isError: true }),
    };
  },
};
