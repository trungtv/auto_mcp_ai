import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  listCapabilitiesForSite,
  listSeedCapabilities,
  resolveAdapter,
  type Capability,
} from "@auto-mcp/site-adapters";
import { planCompile, rebuildIr } from "@auto-mcp/compiler";
import { toolsFromCandidates, upgradeTools } from "@auto-mcp/mcp-generator";
import type { ApiCandidate, McpSite, ToolDef } from "@auto-mcp/shared";

export type SeedReadiness = {
  adapterId: string;
  seedCapabilityNames: string[];
  effectiveCapabilityNames: string[];
  /** True when at least one capability is publishable (seeds unlocked or stored). */
  hasPublishableCapabilities: boolean;
};

export type PublishGap = {
  primitiveNames: string[];
  mcpToolNames: string[];
  unmappedPrimitives: string[];
  publishHint: string;
};

function boundPrimitiveNames(caps: Capability[]): Set<string> {
  const out = new Set<string>();
  for (const cap of caps) {
    const bind = cap.bind;
    if (!bind) continue;
    if (bind.kind === "primitive") {
      out.add(bind.primitive);
    } else if (bind.kind === "pipeline") {
      for (const step of bind.steps) out.add(step.primitive);
    }
  }
  return out;
}

/** Approved primitives with no effective MCP capability bind (specialized adapters). */
export function summarizePublishGap(site: McpSite): PublishGap {
  const primitives = upgradeTools(site.tools.filter((t) => t.approved !== false));
  const primitiveNames = primitives.map((t) => t.name);
  const effective = listCapabilitiesForSite({ site, primitives });
  const mcpToolNames = effective.map((c) => c.name);
  const adapter = resolveAdapter(site);
  let bound = boundPrimitiveNames(effective);
  if (adapter.id === "generic-replay") {
    bound = new Set(primitiveNames);
  }
  const unmappedPrimitives = primitiveNames.filter((n) => !bound.has(n));
  const publishHint =
    unmappedPrimitives.length > 0
      ? `${unmappedPrimitives.length} primitive(s) chưa có MCP tool: ${unmappedPrimitives.join(", ")}. Cần pack seed hoặc upsert_capability — hosted MCP chỉ list capabilities, không dump primitive thô.`
      : mcpToolNames.length > 0
        ? `Hosted MCP tools (${mcpToolNames.length}): ${mcpToolNames.join(", ")}.`
        : "Chưa có MCP capability — compile primitive khớp pack hoặc upsert_capability.";
  return {
    primitiveNames,
    mcpToolNames,
    unmappedPrimitives,
    publishHint,
  };
}

export function summarizeSeedReadiness(site: McpSite): SeedReadiness {
  const primitives = upgradeTools(site.tools.filter((t) => t.approved));
  const seeds = listSeedCapabilities({ site, primitives });
  const effective = listCapabilitiesForSite({ site, primitives });
  return {
    adapterId: resolveAdapter(site).id,
    seedCapabilityNames: seeds.map((c) => c.name),
    effectiveCapabilityNames: effective.map((c) => c.name),
    hasPublishableCapabilities: effective.length > 0,
  };
}

export function toolNamesFromCandidateIds(
  candidates: ApiCandidate[],
  ids: string[],
): string[] {
  return toolsFromCandidates(candidates, ids).map((t) => t.name);
}

export function buildApprovePreview(opts: {
  site: McpSite;
  candidateIds: string[];
  plannedNames?: string[];
}): {
  willApproveCount: number;
  willCreateToolNames: string[];
  seedReadiness: SeedReadiness;
  adapterId: string;
} {
  const names =
    opts.plannedNames ??
    planCompile({
      ir: rebuildIr(
        opts.site.observedActions ?? [],
        opts.site.candidates,
        opts.site.endpointIr ?? [],
      ),
      candidates: opts.site.candidates,
      candidateIds: opts.candidateIds,
    }).tools.map((t) => t.name);
  return {
    willApproveCount: names.length,
    willCreateToolNames: names,
    seedReadiness: summarizeSeedReadiness(opts.site),
    adapterId: resolveAdapter(opts.site).id,
  };
}

export function capabilityPublishSummary(site: McpSite): {
  capabilityNames: string[];
  seedNames: string[];
  empty: boolean;
  seedReadiness: SeedReadiness;
} {
  const readiness = summarizeSeedReadiness(site);
  return {
    capabilityNames: readiness.effectiveCapabilityNames,
    seedNames: readiness.seedCapabilityNames,
    empty: !readiness.hasPublishableCapabilities,
    seedReadiness: readiness,
  };
}

export function nextAfterApprove(site: McpSite): string {
  const live = capabilityPublishSummary(site);
  if (live.empty) {
    const seeds = live.seedNames.length
      ? live.seedNames.join(", ")
      : "(none — upsert_capability or explore more APIs)";
    return `Approved primitives saved, but no business capabilities yet. Adapter \`${live.seedReadiness.adapterId}\` seeds: ${seeds}. Approve primitives that unlock seeds, then list_capabilities before register_site_mcp.`;
  }
  const gap = summarizePublishGap(site);
  const caps = live.capabilityNames.slice(0, 12).join(", ");
  if (gap.unmappedPrimitives.length > 0) {
    return `Primitives saved. MCP tools (${live.capabilityNames.length}): ${caps}. Unmapped primitives: ${gap.unmappedPrimitives.join(", ")}. Call list_capabilities — do not claim tools that are not in mcpToolNames.`;
  }
  return `Call list_capabilities (expect: ${caps}). Then register_site_mcp and reload Cursor MCP server key for this site. Site MCP exposes capabilities, not raw primitives.`;
}

export function nextAfterRegister(opts: {
  site: McpSite;
  mcpKey: string;
}): { message: string; warning?: string; capabilities: string[] } {
  const live = capabilityPublishSummary(opts.site);
  if (live.empty) {
    return {
      capabilities: [],
      warning:
        "Registered MCP entry, but tools/list may be empty until seed capabilities are unlocked (approve matching primitives or upsert_capability).",
      message: `Wrote ${opts.mcpKey}. Reload that MCP server in Cursor, then explore + approve_candidates before expecting tools.`,
    };
  }
  return {
    capabilities: live.capabilityNames,
    message: `Wrote ${opts.mcpKey}. Reload MCP server "${opts.mcpKey}" in Cursor. tools/list will show capabilities: ${live.capabilityNames.join(", ")}. Prefer try_capability on meta MCP first to smoke-test.`,
  };
}

const META_FILE = "control-meta.json";

export function loadActiveSiteId(dataDir: string): string | null {
  const path = join(dataDir, META_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      activeSiteId?: unknown;
    };
    return typeof raw.activeSiteId === "string" && raw.activeSiteId.trim()
      ? raw.activeSiteId.trim()
      : null;
  } catch {
    return null;
  }
}

export function saveActiveSiteId(
  dataDir: string,
  activeSiteId: string | null,
): void {
  const path = join(dataDir, META_FILE);
  writeFileSync(
    path,
    `${JSON.stringify({ activeSiteId }, null, 2)}\n`,
    "utf8",
  );
}

export const CONTROL_MCP_INSTRUCTIONS = `auto_mcp_ai meta MCP — publish website APIs as Cursor MCP capabilities.

Workflow:
1) create_site (or set_active_site)
2) login_start → user logs in browser → login_confirm
3) Explore SPA: network_mark → browser_goto hoặc browser_click menu → browser_wait → network_snapshot. quick_scan (reuseSession:true mặc định). set_explore_path cho quick_scan. Không script Playwright parallel cùng profile.
4) list_endpoint_ir → đề xuất tên (rename_endpoint_ir) → compile_endpoints / approve_candidates confirm:true
5) test_endpoint_ir confirm:true → list_capability_graph → upsert_capability (optional endpointIrId / endpointIrIds)
6) try_capability to smoke-test → register_site_mcp → reload the per-site MCP key in Cursor

Demo pack: @auto-mcp/site-adapter-jira (wired in adapters.extra.ts). More packs: auto_mcp_ai_sample_packs or your own repo (same layout).
Primitive = captured HTTP call. Capability = agent-facing tool (domain format / pipeline).

Hotellink: click menu (Reports, Setup, MISC) thay vì hash đoán. reuseSession:false có thể đá login/CAPTCHA.`;
