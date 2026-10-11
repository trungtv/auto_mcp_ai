import jmespath from "jmespath";
import { GWT_BODY_LIMIT } from "@auto-mcp/shared";
import { genericHttpHandler } from "./generic-http.js";
import type { FormatHandler } from "../types.js";

const JSON_PARSE_BYTE_LIMIT = 4 * 1024 * 1024;
const EXPRESSION_MAX_LEN = 256;

export function parseJmespathExpression(
  opts: Record<string, unknown> | undefined,
): string {
  const raw = opts?.expression;
  if (typeof raw !== "string") {
    throw new Error("formatOptions.expression is required for generic.jmespath");
  }
  const expression = raw.trim();
  if (!expression) {
    throw new Error("formatOptions.expression must not be empty");
  }
  if (expression.length > EXPRESSION_MAX_LEN) {
    throw new Error(
      `formatOptions.expression exceeds max length ${EXPRESSION_MAX_LEN}`,
    );
  }
  if (/[\n\r;]/.test(expression)) {
    throw new Error("formatOptions.expression must not contain newlines or semicolons");
  }
  return expression;
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

export const genericJmespathHandler: FormatHandler = {
  id: "generic.jmespath",
  validateOptions(opts) {
    parseJmespathExpression(opts);
  },
  format(ctx) {
    const status = Number(ctx.meta.status ?? 0);
    const raw = bodyText(ctx.body);
    const ok = isOk(status, ctx.body);
    const includeRaw = ctx.includeRaw === true;
    let expression: string;
    try {
      expression = parseJmespathExpression(ctx.formatOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: message }],
        structuredContent: {
          ...ctx.meta,
          ok: false,
          status,
          format: ctx.format,
          jmespathError: message,
        },
        isError: true,
      };
    }

    if (raw.length > JSON_PARSE_BYTE_LIMIT) {
      const http = genericHttpHandler.format(ctx);
      return {
        ...http,
        structuredContent: {
          ...(http.structuredContent ?? {}),
          parseSkipped: true,
          parseSkipReason: `body exceeds ${JSON_PARSE_BYTE_LIMIT} bytes`,
          format: ctx.format,
          expression,
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
    }

    let data: unknown;
    let jmespathError: string | undefined;
    if (!parseError) {
      try {
        data = jmespath.search(parsed, expression);
      } catch (err) {
        jmespathError = err instanceof Error ? err.message : String(err);
      }
    }

    const structuredContent: Record<string, unknown> = {
      ...ctx.meta,
      ok: ok && !parseError && !jmespathError,
      status,
      format: ctx.format,
      expression,
      data,
      byteLength: raw.length,
    };
    if (parseError) structuredContent.parseError = parseError;
    if (jmespathError) structuredContent.jmespathError = jmespathError;
    if (includeRaw) {
      structuredContent.rawBody =
        raw.length > GWT_BODY_LIMIT ? raw.slice(0, GWT_BODY_LIMIT) : raw;
      structuredContent.rawTruncated = raw.length > GWT_BODY_LIMIT;
    }

    const text =
      parseError
        ? `JSON parse failed: ${parseError}`
        : jmespathError
          ? `JMESPath failed: ${jmespathError}`
          : `HTTP ${status} · jmespath ok · expression=${expression}`;

    return {
      content: [{ type: "text", text }],
      structuredContent,
      ...(ok && !parseError && !jmespathError ? {} : { isError: true }),
    };
  },
};
