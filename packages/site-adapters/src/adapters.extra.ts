/**
 * Wired by scripts/wire-qldt.mjs — QLĐT only (dev).
 */
import type { SiteAdapter } from "./types.js";
import { qldtAdapter } from "@entrade/site-adapter-qldt";

export const extraAdapters: SiteAdapter[] = [qldtAdapter];
