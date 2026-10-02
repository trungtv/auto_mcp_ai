import type { CaptureContext, ToolDef } from "@auto-mcp/shared";
import { truncateGwtAware } from "@auto-mcp/shared";

export const STRUCTURED_BODY_LIMIT = 48_000;
export const TEXT_PREVIEW_LIMIT = 2_048;

export type ReplayRawResult = {
  status: number;
  body: unknown;
};

export type ReplayStructuredContent = {
  status: number;
  ok: boolean;
  contentTypeHint: string;
  byteLength: number;
  truncated: boolean;
  bodyPreview: string;
  captureContext: CaptureContext;
};

function bodyToText(body: unknown): string {
  if (typeof body === "string") return body;
  return JSON.stringify(body, null, 2);
}

function contentTypeHint(body: unknown): string {
  if (typeof body === "string") {
    const t = body.trimStart();
    if (t.startsWith("//OK") || t.startsWith("//EX")) return "text/x-gwt-rpc";
    return "text/plain";
  }
  return "application/json";
}

function isBodyOk(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  if (typeof body === "string") {
    const t = body.trimStart();
    if (t.startsWith("//EX")) return false;
  }
  return true;
}

/** Prefer keeping GWT string table (tail) when truncating primitive replay dumps. */
export function truncatePreview(
  raw: string,
  limit: number,
): { text: string; truncated: boolean } {
  return truncateGwtAware(raw, limit);
}

export function formatReplayResult(
  result: ReplayRawResult,
  tool?: Pick<ToolDef, "captureContext">,
  opts?: { structuredLimit?: number; textLimit?: number },
): {
  structuredContent: ReplayStructuredContent;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const structuredLimit = opts?.structuredLimit ?? STRUCTURED_BODY_LIMIT;
  const textLimit = opts?.textLimit ?? TEXT_PREVIEW_LIMIT;
  const raw = bodyToText(result.body);
  const structured = truncatePreview(raw, structuredLimit);
  const text = truncatePreview(raw, textLimit);
  const captureContext = (tool?.captureContext ?? {}) as CaptureContext;
  const ok = isBodyOk(result.status, result.body);

  const structuredContent: ReplayStructuredContent = {
    status: result.status,
    ok,
    contentTypeHint: contentTypeHint(result.body),
    byteLength: raw.length,
    truncated: structured.truncated,
    bodyPreview: structured.text,
    captureContext,
  };

  const summary = `HTTP ${result.status} · ${structuredContent.contentTypeHint} · ${raw.length} bytes${structured.truncated ? " (truncated)" : ""}${ok ? "" : " · not ok"}`;

  return {
    structuredContent,
    content: [
      {
        type: "text",
        text: `${summary}\n\n${text.text}`,
      },
    ],
    ...(ok ? {} : { isError: true }),
  };
}
