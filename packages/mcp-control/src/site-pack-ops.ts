import type { Registry } from "@auto-mcp/registry";
import {
  getAdapterById,
  listAdapters,
  listCapabilitiesForSite,
  resolveAdapter,
  validateFormatOptions,
} from "@auto-mcp/site-adapters";
import { upgradeTools } from "@auto-mcp/mcp-generator";
import {
  type CapabilityDef,
  type CapabilityPublishMode,
  type McpSite,
  type ToolDef,
} from "@auto-mcp/shared";
import { suggestFormatForPrimitive } from "./suggest-capability-format.js";

const BOOTSTRAP_MAX = 64;

function requireSite(registry: Registry, siteId: string): McpSite {
  const site = registry.get(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);
  return site;
}

function irForPrimitive(site: McpSite, primitiveName: string) {
  return (site.endpointIr ?? []).find(
    (ir) => ir.compiledPrimitive === primitiveName,
  );
}

function buildCapabilityFromPrimitive(
  site: McpSite,
  tool: ToolDef,
): { capability: CapabilityDef; rationale: string } {
  const suggestion = suggestFormatForPrimitive(site, tool);
  const rec = suggestion.recommended;
  const bind: CapabilityDef["bind"] = {
    kind: "primitive",
    primitive: tool.name,
    format: rec.format,
    ...(rec.formatOptions ? { formatOptions: rec.formatOptions } : {}),
  };
  validateFormatOptions(rec.format, rec.formatOptions);
  const capability: CapabilityDef = {
    name: tool.name,
    title: tool.title,
    description: tool.description || `Replay ${tool.method} ${tool.url}`,
    inputSchema: (tool.inputSchema ?? {
      type: "object",
      properties: {},
    }) as CapabilityDef["inputSchema"],
    outputSchema: rec.outputSchema,
    bind,
    enabled: true,
    updatedAt: new Date().toISOString(),
  };
  return { capability, rationale: rec.rationale };
}

export function listInstalledAdaptersOp(
  registry: Registry,
  siteId: string,
): Record<string, unknown> {
  const site = requireSite(registry, siteId);
  const adapters = listAdapters();
  return {
    siteId,
    adapterPackId: site.adapterPackId,
    capabilityPublishMode: site.capabilityPublishMode,
    adapters: adapters.map((a) => ({
      id: a.id,
      knownFormats: a.knownFormats ?? [],
      matchesSite: a.match(site),
    })),
    resolvedAdapterId: (() => {
      try {
        return resolveAdapter(site).id;
      } catch {
        return null;
      }
    })(),
  };
}

export function setSiteAdapterPackOp(
  registry: Registry,
  siteId: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (args.confirm !== true) {
    return {
      preview: true,
      refused: true,
      next: "Pass confirm:true after the user agrees to pin or clear the site adapter pack.",
      draft: { adapterPackId: args.adapterPackId ?? null },
    };
  }
  const site = requireSite(registry, siteId);
  const raw = args.adapterPackId;
  const adapterPackId =
    raw === null || raw === undefined || raw === ""
      ? null
      : String(raw).trim();
  if (adapterPackId && !getAdapterById(adapterPackId)) {
    throw new Error(
      `adapterPackId \`${adapterPackId}\` is not installed. Call list_installed_adapters.`,
    );
  }
  const updated = registry.update(site.id, { adapterPackId });
  return {
    preview: false,
    siteId,
    adapterPackId: updated.adapterPackId,
    resolvedAdapterId: resolveAdapter(updated).id,
    next: "list_capabilities to verify seeds and effective tools.",
  };
}

export function setCapabilityPublishModeOp(
  registry: Registry,
  siteId: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (args.confirm !== true) {
    return {
      preview: true,
      refused: true,
      next: "Pass confirm:true to change capabilityPublishMode (auto | curated).",
      draft: { mode: args.mode },
    };
  }
  const mode = String(args.mode ?? "").trim() as CapabilityPublishMode;
  if (mode !== "auto" && mode !== "curated") {
    throw new Error("mode must be auto or curated");
  }
  const site = requireSite(registry, siteId);
  const updated = registry.update(site.id, { capabilityPublishMode: mode });
  const primitives = upgradeTools(updated.tools.filter((t) => t.approved));
  const effective = listCapabilitiesForSite({ site: updated, primitives });
  return {
    preview: false,
    capabilityPublishMode: updated.capabilityPublishMode,
    effectiveCount: effective.length,
    next:
      mode === "auto"
        ? "Generic sites expose all approved primitives as MCP tools."
        : "Curated mode lists stored capabilities (+ pack seeds) only.",
  };
}

export function bootstrapSitePackOp(
  registry: Registry,
  siteId: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const site = requireSite(registry, siteId);
  const approved = upgradeTools(
    site.tools.filter((t) => t.approved !== false),
  );
  const filterNames = Array.isArray(args.primitiveNames)
    ? args.primitiveNames.map(String)
    : undefined;
  let tools = approved;
  if (filterNames?.length) {
    const set = new Set(filterNames);
    tools = approved.filter((t) => set.has(t.name));
  }
  if (tools.length > BOOTSTRAP_MAX) {
    throw new Error(
      `Too many primitives (${tools.length}). Pass primitiveNames or approve fewer (max ${BOOTSTRAP_MAX}).`,
    );
  }

  const built = tools.map((t) => buildCapabilityFromPrimitive(site, t));
  const drafts = built.map((b) => b.capability);
  const replaceExisting = args.replaceExisting === true;

  if (args.confirm !== true) {
    const stored = site.capabilities ?? [];
    return {
      preview: true,
      refused: true,
      wouldSetMode: "curated" as const,
      draftCapabilities: drafts,
      draftWithRationale: built.map((b) => ({
        capability: b.capability,
        rationale: b.rationale,
      })),
      draftCount: drafts.length,
      storedCount: stored.length,
      replaceExisting,
      next: "Pass confirm:true after the user agrees to write curated site pack capabilities.",
    };
  }

  const existing = site.capabilities ?? [];
  const byName = new Map(existing.map((c) => [c.name, c]));
  if (replaceExisting) {
    for (const d of drafts) byName.delete(d.name);
  }
  for (const d of built.map((b) => b.capability)) {
    byName.set(d.name, d);
  }
  const nextCaps = [...byName.values()];
  const updated = registry.update(site.id, {
    capabilities: nextCaps,
    capabilityPublishMode: "curated",
  });
  const primitives = upgradeTools(updated.tools.filter((t) => t.approved));
  const effective = listCapabilitiesForSite({ site: updated, primitives });
  return {
    preview: false,
    storedCount: nextCaps.length,
    capabilityPublishMode: updated.capabilityPublishMode,
    effectiveCount: effective.length,
    effectiveNames: effective.map((c) => c.name),
    next: "try_capability smoke-test, then list_capabilities / get_hosted_mcp_info.",
  };
}
