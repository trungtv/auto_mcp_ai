import type { FormatHandler } from "./types.js";
import { genericHttpHandler } from "./handlers/generic-http.js";
import { genericJsonHandler } from "./handlers/generic-json.js";

const HANDLERS = new Map<string, FormatHandler>([
  [genericHttpHandler.id, genericHttpHandler],
  [genericJsonHandler.id, genericJsonHandler],
]);

export function registerFormatHandler(handler: FormatHandler): void {
  HANDLERS.set(handler.id, handler);
}

export function getFormatHandler(id: string): FormatHandler | undefined {
  return HANDLERS.get(id);
}

export function listFormatHandlerIds(): string[] {
  return [...HANDLERS.keys()].sort();
}

export function validateFormatOptions(
  format: string,
  formatOptions: Record<string, unknown> | undefined,
): void {
  const handler = HANDLERS.get(format);
  if (!handler) {
    throw new Error(`Unknown format \`${format}\` for formatOptions validation`);
  }
  handler.validateOptions(formatOptions);
}

export function formatWithEngine(
  ctx: import("../types.js").FormatContext,
): import("../types.js").CapabilityResult {
  const handler = HANDLERS.get(ctx.format);
  if (!handler) {
    return {
      content: [
        {
          type: "text",
          text: `No format handler for \`${ctx.format}\``,
        },
      ],
      isError: true,
    };
  }
  return handler.format(ctx);
}
