import { extraAdapters } from "./adapters.extra.js";
import { mergeCapabilities } from "./bound.js";
import { genericReplayAdapter } from "./generic.js";
import type { AdapterContext, Capability, SiteAdapter } from "./types.js";

/** Site packs from adapters.extra.ts; generic replay is last-resort fallback. */
const ADAPTERS: SiteAdapter[] = [...extraAdapters];

export function listAdapters(): SiteAdapter[] {
  return [...ADAPTERS];
}

/** All pack-owned format ids (for MCP tool descriptions). */
export function listKnownFormats(): string[] {
  const out = new Set<string>();
  for (const a of ADAPTERS) {
    for (const f of a.knownFormats ?? []) out.add(f);
  }
  return [...out].sort();
}

export function resolveAdapter(site: AdapterContext["site"]): SiteAdapter {
  for (const adapter of ADAPTERS) {
    if (adapter.match(site)) return adapter;
  }
  return genericReplayAdapter;
}

/**
 * Effective MCP business tools for a site:
 * - Seeds from pack + DB capabilities (DB wins by name).
 * - Specialized pack with neither → empty (do not leak raw primitives).
 * - generic-replay with no stored → approved primitives (unknown host).
 */
export function listCapabilitiesForSite(
  ctx: Pick<AdapterContext, "site" | "primitives">,
): Capability[] {
  const adapter = resolveAdapter(ctx.site);
  const stored = ctx.site.capabilities ?? [];
  const seeds = adapter.capabilities(ctx);

  if (adapter.id === "generic-replay") {
    if (stored.length === 0) {
      return adapter.capabilities(ctx);
    }
    return mergeCapabilities([], stored, adapter, ctx.site.endpointIr ?? []);
  }

  if (stored.length === 0) {
    return seeds;
  }

  return mergeCapabilities(seeds, stored, adapter, ctx.site.endpointIr ?? []);
}

export function getCapability(
  ctx: Pick<AdapterContext, "site" | "primitives">,
  name: string,
): Capability | undefined {
  return listCapabilitiesForSite(ctx).find((c) => c.name === name);
}

/** Seeds only (no DB merge) — for meta MCP introspection. */
export function listSeedCapabilities(
  ctx: Pick<AdapterContext, "site" | "primitives">,
): Capability[] {
  return resolveAdapter(ctx.site).capabilities(ctx);
}
