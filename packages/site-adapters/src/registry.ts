import { extraAdapters } from "./adapters.extra.js";
import { mergeCapabilities } from "./bound.js";
import { listFormatHandlerIds } from "./format-engine/index.js";
import { genericReplayAdapter } from "./generic.js";
import type { AdapterContext, Capability, SiteAdapter } from "./types.js";
import type { McpSite } from "@auto-mcp/shared";

/** Site packs from adapters.extra.ts; generic replay is last-resort fallback. */
const ADAPTERS: SiteAdapter[] = [...extraAdapters];

export function listAdapters(): SiteAdapter[] {
  return [...ADAPTERS];
}

export function getAdapterById(id: string): SiteAdapter | undefined {
  if (id === genericReplayAdapter.id) return genericReplayAdapter;
  return ADAPTERS.find((a) => a.id === id);
}

export function adapterPackIdError(site: McpSite): string | undefined {
  const pin = site.adapterPackId;
  if (!pin) return undefined;
  if (!getAdapterById(pin)) {
    return `adapterPackId \`${pin}\` is not installed on this server. Call list_installed_adapters.`;
  }
  return undefined;
}

export type ResolveAdapterResult =
  | { adapter: SiteAdapter; adapterError?: undefined }
  | { adapter?: undefined; adapterError: string };

export function resolveAdapterOrError(site: McpSite): ResolveAdapterResult {
  const pinErr = adapterPackIdError(site);
  if (pinErr) return { adapterError: pinErr };
  return { adapter: resolveAdapter(site) };
}

/** All pack-owned format ids (for MCP tool descriptions). */
export function listKnownFormats(): string[] {
  const out = new Set<string>(listFormatHandlerIds());
  for (const a of ADAPTERS) {
    for (const f of a.knownFormats ?? []) out.add(f);
  }
  return [...out].sort();
}

export function resolveAdapter(site: AdapterContext["site"]): SiteAdapter {
  const pin = site.adapterPackId;
  if (pin) {
    const pinned = getAdapterById(pin);
    if (!pinned) {
      throw new Error(
        `adapterPackId \`${pin}\` is not installed. Call list_installed_adapters.`,
      );
    }
    return pinned;
  }
  for (const adapter of ADAPTERS) {
    if (adapter.match(site)) return adapter;
  }
  return genericReplayAdapter;
}

function isGenericCurated(site: McpSite): boolean {
  return site.capabilityPublishMode === "curated";
}

/**
 * Effective MCP business tools for a site:
 * - Seeds from pack + DB capabilities (DB wins by name).
 * - Specialized pack with neither → empty (do not leak raw primitives).
 * - generic-replay auto → approved primitives; curated → stored capabilities only.
 */
export function listCapabilitiesForSite(
  ctx: Pick<AdapterContext, "site" | "primitives">,
): Capability[] {
  const resolved = resolveAdapterOrError(ctx.site);
  if (resolved.adapterError || !resolved.adapter) return [];
  const adapter = resolved.adapter;
  const stored = ctx.site.capabilities ?? [];
  const seeds = adapter.capabilities(ctx);

  if (adapter.id === "generic-replay") {
    if (!isGenericCurated(ctx.site)) {
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
  const resolved = resolveAdapterOrError(ctx.site);
  if (resolved.adapterError || !resolved.adapter) return [];
  return resolved.adapter.capabilities(ctx);
}
