import {
  boundEndpointIrIds,
  candidateKey,
  type ApiCandidate,
  type CapabilityBind,
  type EndpointIr,
} from "@auto-mcp/shared";
import type {
  SiteCapabilityInventoryItem,
  SiteToolInventoryItem,
} from "./browser-tools.js";

function methodPathKey(method: string, url: string): string {
  try {
    const u = new URL(url);
    return `${method.toUpperCase()} ${u.origin}${u.pathname}`;
  } catch {
    return `${method.toUpperCase()} ${url.split("?")[0]}`;
  }
}

function primitiveKey(t: SiteToolInventoryItem): string | null {
  if (!t.method || !t.url) return null;
  const base = methodPathKey(t.method, t.url);
  return t.rpcMethod ? `${base}#${t.rpcMethod}` : base;
}

export type CoverageAnalysis = {
  covered: Array<{
    candidateId: string;
    method: string;
    url: string;
    primitiveName?: string;
    capabilityNames: string[];
    irKey?: string;
    suggestedName?: string;
    lastContractOk?: boolean;
    lastMutationOk?: boolean;
  }>;
  candidateOnly: Array<{
    candidateId: string;
    method: string;
    url: string;
    status?: number;
    irKey?: string;
    suggestedName?: string;
    kind?: string;
    lastContractOk?: boolean;
    lastMutationOk?: boolean;
  }>;
  capabilityWithoutRecentCandidate: Array<{
    capabilityName: string;
    primitive?: string;
    note: string;
  }>;
  summary: {
    candidates: number;
    covered: number;
    candidateOnly: number;
    capabilities: number;
    orphanCapabilities: number;
    endpointIr: number;
  };
};

/**
 * Coverage: match IR.key ↔ primitive.url (query stripped, +#rpcMethod for GWT).
 * When IR is empty, match raw candidates the same way.
 */
export function analyzeCoverage(opts: {
  candidates: ApiCandidate[];
  primitives: SiteToolInventoryItem[];
  capabilities: SiteCapabilityInventoryItem[];
  endpointIr?: EndpointIr[];
}): CoverageAnalysis {
  const primByKey = new Map<string, SiteToolInventoryItem>();
  const primByName = new Map<string, SiteToolInventoryItem>();
  for (const t of opts.primitives) {
    primByName.set(t.name, t);
    const key = primitiveKey(t);
    if (key) primByKey.set(key, t);
    if (t.method && t.url) {
      const base = methodPathKey(t.method, t.url);
      if (!primByKey.has(base)) primByKey.set(base, t);
    }
  }

  const capsByPrimitive = new Map<string, string[]>();
  for (const c of opts.capabilities) {
    const bind = c.bind;
    if (!bind || typeof bind !== "object") continue;
    const b = bind as {
      kind?: string;
      primitive?: string;
      endpointIrId?: string;
      endpointIrIds?: string[];
      steps?: Array<{ primitive?: string }>;
    };
    const names: string[] = [];
    if (b.kind === "primitive" && typeof b.primitive === "string") {
      names.push(b.primitive);
      for (const id of boundEndpointIrIds(bind as CapabilityBind)) {
        const compiled = opts.endpointIr?.find((e) => e.id === id)
          ?.compiledPrimitive;
        if (compiled) names.push(compiled);
      }
    }
    if (b.kind === "pipeline" && Array.isArray(b.steps)) {
      for (const s of b.steps) {
        if (typeof s.primitive === "string") names.push(s.primitive);
      }
    }
    for (const p of names) {
      const list = capsByPrimitive.get(p) ?? [];
      list.push(c.name);
      capsByPrimitive.set(p, list);
    }
  }

  type Unit = {
    id: string;
    method: string;
    url: string;
    key: string;
    status?: number;
    suggestedName?: string;
    kind?: string;
    compiledPrimitive?: string;
    lastContractOk?: boolean;
    lastMutationOk?: boolean;
  };

  const ir = opts.endpointIr ?? [];
  const units: Unit[] =
    ir.length > 0
      ? ir.map((e) => ({
          id: e.id,
          method: e.method,
          url: e.urlTemplate,
          key: e.key,
          suggestedName: e.suggestedName,
          kind: e.kind,
          compiledPrimitive: e.compiledPrimitive,
          lastContractOk: e.lastContract?.ok,
          lastMutationOk: e.lastMutation?.ok,
        }))
      : opts.candidates.map((c) => ({
          id: c.id,
          method: c.method,
          url: c.url,
          key: candidateKey(c),
          status: c.status,
        }));

  const covered: CoverageAnalysis["covered"] = [];
  const candidateOnly: CoverageAnalysis["candidateOnly"] = [];
  const seenKeys = new Set<string>();

  for (const u of units) {
    seenKeys.add(u.key);
    seenKeys.add(methodPathKey(u.method, u.url));
    const prim =
      (u.compiledPrimitive ? primByName.get(u.compiledPrimitive) : undefined) ??
      primByKey.get(u.key) ??
      primByKey.get(methodPathKey(u.method, u.url));
    if (prim) {
      covered.push({
        candidateId: u.id,
        method: u.method,
        url: u.url,
        primitiveName: prim.name,
        capabilityNames: capsByPrimitive.get(prim.name) ?? [],
        irKey: u.key,
        suggestedName: u.suggestedName,
        lastContractOk: u.lastContractOk,
        lastMutationOk: u.lastMutationOk,
      });
    } else {
      candidateOnly.push({
        candidateId: u.id,
        method: u.method,
        url: u.url,
        status: u.status,
        irKey: u.key,
        suggestedName: u.suggestedName,
        kind: u.kind,
        lastContractOk: u.lastContractOk,
        lastMutationOk: u.lastMutationOk,
      });
    }
  }

  const capabilityWithoutRecentCandidate: CoverageAnalysis["capabilityWithoutRecentCandidate"] =
    [];
  for (const c of opts.capabilities) {
    const bind = c.bind as
      | {
          kind?: string;
          primitive?: string;
          steps?: Array<{ primitive?: string }>;
        }
      | undefined;
    let primitives: string[] = [];
    if (bind?.kind === "primitive" && bind.primitive) {
      primitives = [bind.primitive];
      for (const id of boundEndpointIrIds(c.bind as CapabilityBind)) {
        const compiled = opts.endpointIr?.find((e) => e.id === id)
          ?.compiledPrimitive;
        if (compiled && !primitives.includes(compiled)) primitives.push(compiled);
      }
    }
    if (bind?.kind === "pipeline" && bind.steps) {
      primitives = bind.steps
        .map((s) => s.primitive)
        .filter((p): p is string => typeof p === "string");
    }
    if (primitives.length === 0) {
      capabilityWithoutRecentCandidate.push({
        capabilityName: c.name,
        note: "No bind.primitive to match against candidates",
      });
      continue;
    }
    const missing = primitives.filter((p) => {
      const tool = opts.primitives.find((t) => t.name === p);
      if (!tool?.url || !tool.method) return true;
      const key = primitiveKey(tool);
      const base = methodPathKey(tool.method, tool.url);
      return !seenKeys.has(key ?? base) && !seenKeys.has(base);
    });
    if (missing.length) {
      capabilityWithoutRecentCandidate.push({
        capabilityName: c.name,
        primitive: missing.join(","),
        note: "Bound primitive(s) have no matching IR/candidate in current explore set",
      });
    }
  }

  return {
    covered,
    candidateOnly: candidateOnly.slice(0, 60),
    capabilityWithoutRecentCandidate,
    summary: {
      candidates: opts.candidates.length,
      covered: covered.length,
      candidateOnly: candidateOnly.length,
      capabilities: opts.capabilities.length,
      orphanCapabilities: capabilityWithoutRecentCandidate.length,
      endpointIr: ir.length,
    },
  };
}
