import type { SiteAdapter } from "./types.js";

/**
 * After cloning auto_mcp_ai_sample_packs, run: pnpm wire:sample (dev tree) or pnpm wire:core in that repo
 *
 * Or paste:
 *   import { jiraAdapter } from "@auto-mcp/site-adapter-jira";
 *   export const extraAdapters: SiteAdapter[] = [jiraAdapter];
 */
export const extraAdapters: SiteAdapter[] = [];
