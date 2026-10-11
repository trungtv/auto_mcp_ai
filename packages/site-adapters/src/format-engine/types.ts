import type { CapabilityResult, FormatContext } from "../types.js";

export type FormatHandler = {
  id: string;
  validateOptions: (opts: Record<string, unknown> | undefined) => void;
  format: (ctx: FormatContext) => CapabilityResult;
};
