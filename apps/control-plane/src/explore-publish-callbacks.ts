import type { Registry } from "@auto-mcp/registry";
import type { Vault } from "@auto-mcp/vault";
import type { BrowserToolCallbacks } from "@auto-mcp/cursor-discover";
import {
  approveCandidatesOp,
  compileEndpointsOp,
  listCapabilityGraphOp,
  listEndpointIrOp,
  persistCapture,
  registerSiteMcpOp,
  renameEndpointIrOp,
  testEndpointIrOp,
  tryCapabilityOp,
  upsertCapabilityOp,
  type SiteOpsContext,
} from "@auto-mcp/mcp-control";

export function siteOpsFrom(opts: {
  registry: Registry;
  vault: Vault;
  dataDir: string;
  masterKey: string;
  runtimeEntry: string;
}): SiteOpsContext {
  return {
    registry: opts.registry,
    vault: opts.vault,
    dataDir: opts.dataDir,
    masterKey: opts.masterKey,
    runtimeEntry: opts.runtimeEntry,
  };
}

/** Publish-loop callbacks for explore agent custom tools. */
export function publishCallbacksForSite(
  ops: SiteOpsContext,
  siteId: string,
): Pick<
  BrowserToolCallbacks,
  | "approveCandidates"
  | "upsertCapability"
  | "tryCapability"
  | "registerSiteMcp"
  | "listObservedActions"
  | "listEndpointIr"
  | "renameEndpointIr"
  | "compileEndpoints"
  | "listCapabilityGraph"
  | "testEndpointIr"
> {
  return {
    approveCandidates: async (args) => approveCandidatesOp(ops, siteId, args),
    upsertCapability: async (args) => upsertCapabilityOp(ops, siteId, args),
    tryCapability: async (args) => tryCapabilityOp(ops, siteId, args),
    registerSiteMcp: async (args) => registerSiteMcpOp(ops, siteId, args),
    listObservedActions: () => ops.registry.get(siteId)?.observedActions ?? [],
    listEndpointIr: () => {
      listEndpointIrOp(ops, siteId);
      return ops.registry.get(siteId)?.endpointIr ?? [];
    },
    renameEndpointIr: async (args) => renameEndpointIrOp(ops, siteId, args),
    compileEndpoints: async (args) => compileEndpointsOp(ops, siteId, args),
    listCapabilityGraph: () => listCapabilityGraphOp(ops, siteId),
    testEndpointIr: async (args) => testEndpointIrOp(ops, siteId, args),
  };
}

export { persistCapture };
