import type { Registry } from "@auto-mcp/registry";
import type { Vault } from "@auto-mcp/vault";
import {
  AuthExpiredError,
  assertToolUrlAllowed,
  buildMcpEntry,
  createSiteReplay,
  defaultCursorMcpPath,
  mergeCursorMcpConfig,
} from "@auto-mcp/mcp-runtime";
import {
  buildCapabilityGraph,
  captureToIr,
  mergeTestEvidence,
  planCompile,
  rebuildIr,
  resolveToolForIr,
  testEndpointContract,
  testEndpointMutation,
  type ReplayLike,
} from "@auto-mcp/compiler";
import { mergeTools, upgradeTools } from "@auto-mcp/mcp-generator";
import {
  getCapability,
  listCapabilitiesForSite,
  packSupportsFormat,
  resolveAdapter,
  type SiteAdapter,
} from "@auto-mcp/site-adapters";
import {
  boundEndpointIrIds,
  CapabilityDefSchema,
  type ApiCandidate,
  type CapabilityDef,
  type IrContractResult,
  type IrMutationResult,
  type McpSite,
  type ObservedUi,
} from "@auto-mcp/shared";
import {
  buildApprovePreview,
  capabilityPublishSummary,
  nextAfterApprove,
  nextAfterRegister,
} from "./workflow.js";

export type SiteOpsContext = {
  registry: Registry;
  vault: Vault;
  dataDir: string;
  masterKey: string;
  /** Absolute path to packages/mcp-runtime/dist/cli.js */
  runtimeEntry: string;
};

function requireSite(registry: Registry, siteId: string): McpSite {
  const site = registry.get(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);
  return site;
}

function parseCapabilityUpsert(args: Record<string, unknown>): CapabilityDef {
  return CapabilityDefSchema.parse({
    name: args.name,
    title: args.title,
    description: args.description,
    inputSchema: args.inputSchema,
    outputSchema: args.outputSchema,
    annotations: args.annotations,
    enabled: args.enabled,
    bind: args.bind,
    updatedAt: new Date().toISOString(),
  });
}

function assertPrimitiveApproved(site: McpSite, primitiveName: string): void {
  const prim = site.tools.find(
    (t) => t.name === primitiveName && t.approved !== false,
  );
  if (!prim) {
    throw new Error(
      `Primitive \`${primitiveName}\` not found or not approved. Explore + approve_candidates first.`,
    );
  }
  assertToolUrlAllowed(prim.url, site.baseUrl);
}

function assertArgMutationSupport(
  adapter: SiteAdapter,
  mutations: {
    semester?: boolean;
    classId?: boolean;
    projectType?: boolean;
  },
  defaults: {
    semester?: string;
    classId?: string;
    projectType?: string;
  },
): void {
  const supports = adapter.supportsArgMutation ?? {};
  if (mutations.semester && !supports.semester) {
    throw new Error(
      `Adapter \`${adapter.id}\` does not support argMutations.semester`,
    );
  }
  if (mutations.classId && !supports.classId) {
    throw new Error(
      `Adapter \`${adapter.id}\` does not support argMutations.classId`,
    );
  }
  if (
    (mutations.projectType || defaults.projectType !== undefined) &&
    !supports.projectType
  ) {
    throw new Error(
      `Adapter \`${adapter.id}\` does not support argMutations/defaults.projectType`,
    );
  }
}

function assertFormatOwned(adapter: SiteAdapter, format: string | undefined): void {
  if (!format) return;
  if (!packSupportsFormat(adapter, format)) {
    throw new Error(
      `Adapter \`${adapter.id}\` does not own format \`${format}\`. Known: ${(adapter.knownFormats ?? []).join(", ") || "none"}.`,
    );
  }
}

export function validateCapabilityDef(
  site: McpSite,
  adapter: SiteAdapter,
  def: CapabilityDef,
): void {
  if (def.enabled === false) return;

  if (def.bind.kind === "pipeline") {
    const steps = def.bind.steps;
    if (steps.length === 0 || steps.length > 5) {
      throw new Error("Pipeline must have 1–5 steps");
    }
    for (const step of steps) {
      assertPrimitiveApproved(site, step.primitive);
      assertArgMutationSupport(
        adapter,
        step.argMutations ?? {},
        step.defaults ?? {},
      );
      assertFormatOwned(adapter, step.format);
    }
    assertFormatOwned(adapter, def.bind.format);
    return;
  }

  if (def.bind.kind !== "primitive") {
    throw new Error(
      `Unsupported bind.kind: ${(def.bind as { kind: string }).kind}`,
    );
  }
  if (
    def.bind.endpointIrId &&
    def.bind.endpointIrIds?.length &&
    !def.bind.endpointIrIds.includes(def.bind.endpointIrId)
  ) {
    throw new Error("endpointIrId must be included in endpointIrIds");
  }
  const irIds = boundEndpointIrIds(def.bind);
  if (irIds.length === 1) {
    assertEndpointIrBind(site, irIds[0]!, def.bind.primitive);
  } else if (irIds.length > 1) {
    const compiled = new Set<string>();
    for (const id of irIds) {
      const ir = (site.endpointIr ?? []).find((e) => e.id === id);
      if (!ir) throw new Error(`Endpoint IR not found: ${id}`);
      if (!ir.compiledPrimitive) {
        throw new Error(
          `Endpoint IR \`${id}\` is not compiled. compile_endpoints confirm:true first.`,
        );
      }
      compiled.add(ir.compiledPrimitive);
      assertPrimitiveApproved(site, ir.compiledPrimitive);
    }
    if (!compiled.has(def.bind.primitive)) {
      throw new Error(
        `bind.primitive \`${def.bind.primitive}\` is not among compiled IR primitives: ${[...compiled].join(", ")}`,
      );
    }
  } else {
    assertPrimitiveApproved(site, def.bind.primitive);
  }
  assertArgMutationSupport(
    adapter,
    def.bind.argMutations ?? {},
    def.bind.defaults ?? {},
  );
  assertFormatOwned(adapter, def.bind.format);
}

export function assertEndpointIrBind(
  site: McpSite,
  endpointIrId: string,
  primitive: string,
): void {
  const ir = (site.endpointIr ?? []).find((e) => e.id === endpointIrId);
  if (!ir) {
    throw new Error(`Endpoint IR not found: ${endpointIrId}`);
  }
  if (!ir.compiledPrimitive) {
    throw new Error(
      `Endpoint IR \`${endpointIrId}\` is not compiled. compile_endpoints confirm:true first.`,
    );
  }
  if (ir.compiledPrimitive !== primitive) {
    throw new Error(
      `endpointIrId compiledPrimitive \`${ir.compiledPrimitive}\` !== bind.primitive \`${primitive}\``,
    );
  }
}

function capabilityFormatWarning(
  adapter: SiteAdapter,
  def: CapabilityDef,
): string | undefined {
  if (def.enabled === false) return undefined;
  const usesDomainFormats = (adapter.knownFormats?.length ?? 0) > 0;
  if (!usesDomainFormats) {
    return undefined;
  }
  if (def.bind.kind === "pipeline") {
    if (def.bind.format || def.bind.steps.some((s) => s.format)) return undefined;
    return `Pipeline \`${def.name}\` has no format on bind/steps — domain output may be thin.`;
  }
  if (def.bind.format) return undefined;
  return `Capability \`${def.name}\` has no bind.format — domain output may be missing.`;
}

function capSummary(cap: {
  name: string;
  title?: string;
  description: string;
  supportsMutation?: boolean;
  bind?: CapabilityDef["bind"];
  inputSchema: Record<string, unknown>;
}) {
  return {
    name: cap.name,
    title: cap.title,
    description: cap.description,
    supportsMutation: Boolean(cap.supportsMutation),
    bind: cap.bind,
    inputSchema: cap.inputSchema,
  };
}

export function persistCapture(
  ctx: Pick<SiteOpsContext, "registry">,
  siteId: string,
  captured: ApiCandidate[],
  ui?: ObservedUi,
  exploreRound?: number,
): McpSite {
  const site = requireSite(ctx.registry, siteId);
  const next = captureToIr({
    actions: site.observedActions ?? [],
    previousIr: site.endpointIr ?? [],
    captured,
    allCandidates: site.candidates,
    ui,
    exploreRound,
  });
  return ctx.registry.update(siteId, next);
}

function irSummaries(ir: ReturnType<typeof rebuildIr>) {
  return ir.map((e) => ({
    id: e.id,
    key: e.key,
    suggestedName: e.suggestedName,
    kind: e.kind,
    method: e.method,
    urlTemplate: e.urlTemplate,
    params: e.params.map((p) => p.name),
    compiledPrimitive: e.compiledPrimitive,
    candidateIds: e.candidateIds,
    lastContract: e.lastContract,
    lastMutation: e.lastMutation,
  }));
}

export function compileEndpointsOp(
  ctx: SiteOpsContext,
  siteId: string,
  args: {
    endpointIds?: string[];
    candidateIds?: string[];
    confirmAll?: boolean;
    confirm?: boolean;
  },
): Record<string, unknown> {
  const site = requireSite(ctx.registry, siteId);
  if (site.candidates.length === 0) {
    throw new Error("No candidates to compile. Explore first.");
  }
  const ir = rebuildIr(
    site.observedActions ?? [],
    site.candidates,
    site.endpointIr ?? [],
  );
  const confirm = args.confirm === true;
  const confirmAll = args.confirmAll === true;
  const hasEndpointIds = Boolean(args.endpointIds && args.endpointIds.length > 0);
  const hasCandidateIds = Boolean(args.candidateIds && args.candidateIds.length > 0);
  const selectOpts =
    hasEndpointIds || hasCandidateIds
      ? { endpointIds: args.endpointIds, candidateIds: args.candidateIds }
      : confirmAll
        ? {}
        : { candidateIds: site.candidates.map((c) => c.id) };

  const plan = planCompile({
    ir,
    candidates: site.candidates,
    ...selectOpts,
  });
  const preview = buildApprovePreview({
    site,
    candidateIds: plan.selected.flatMap((e) => e.candidateIds),
    plannedNames: plan.tools.map((t) => t.name),
  });

  const previewPayload = {
    preview: true as const,
    endpointIr: irSummaries(plan.selected),
    skippedOther: irSummaries(plan.skippedOther),
    willApproveCount: plan.tools.length,
    willCreateToolNames: plan.tools.map((t) => t.name),
    seedReadiness: preview.seedReadiness,
    adapterId: preview.adapterId,
  };

  if (!confirm || (!hasEndpointIds && !hasCandidateIds && !confirmAll)) {
    return {
      ...previewPayload,
      next: confirm
        ? `confirm:true with empty ids requires confirmAll:true to compile all ${plan.tools.length} endpoints.`
        : "Preview only — tools not written. Re-call compile_endpoints or approve_candidates with confirm:true and endpointIds/candidateIds (or confirmAll:true).",
    };
  }

  for (const tool of plan.tools) {
    assertToolUrlAllowed(tool.url, site.baseUrl);
  }
  const tools = mergeTools(site.tools, plan.tools);
  const compiledByName = new Set(plan.tools.map((t) => t.name));
  const nextIr = ir.map((e) =>
    compiledByName.has(e.suggestedName)
      ? { ...e, compiledPrimitive: e.suggestedName }
      : e,
  );
  const updated = ctx.registry.update(site.id, { tools, endpointIr: nextIr });
  const pub = capabilityPublishSummary(updated);
  return {
    preview: false,
    approved: plan.tools.map((t) => t.name),
    endpointIr: irSummaries(nextIr.filter((e) => e.compiledPrimitive)),
    toolCount: updated.tools.filter((t) => t.approved).length,
    seedReadiness: pub.seedReadiness,
    capabilities: pub.capabilityNames,
    next: nextAfterApprove(updated),
  };
}

export function approveCandidatesOp(
  ctx: SiteOpsContext,
  siteId: string,
  args: {
    candidateIds?: string[];
    endpointIds?: string[];
    confirmAll?: boolean;
    confirm?: boolean;
  },
): Record<string, unknown> {
  return compileEndpointsOp(ctx, siteId, args);
}

export function listObservedActionsOp(
  ctx: Pick<SiteOpsContext, "registry">,
  siteId: string,
): Record<string, unknown> {
  const site = requireSite(ctx.registry, siteId);
  const actions = site.observedActions ?? [];
  return {
    total: actions.length,
    actions: actions.slice(-80).map((a) => ({
      id: a.id,
      candidateId: a.candidateId,
      observedAt: a.observedAt,
      exploreRound: a.exploreRound,
      gesture: a.ui?.gesture,
      pageUrl: a.ui?.pageUrl,
      targetText: a.ui?.targetText,
      method: a.network.method,
      url: a.network.url,
      status: a.network.status,
      queryKeys: a.requestSketch.queryKeys,
      bodyKeys: a.requestSketch.bodyKeys,
      responseKeys: a.responseSketch.topKeys,
      rpcMethod: a.responseSketch.rpcMethod,
    })),
  };
}

export function listEndpointIrOp(
  ctx: Pick<SiteOpsContext, "registry">,
  siteId: string,
): Record<string, unknown> {
  const site = requireSite(ctx.registry, siteId);
  const ir = rebuildIr(
    site.observedActions ?? [],
    site.candidates,
    site.endpointIr ?? [],
  );
  if (JSON.stringify(ir) !== JSON.stringify(site.endpointIr ?? [])) {
    ctx.registry.update(siteId, { endpointIr: ir });
  }
  return {
    total: ir.length,
    endpoints: irSummaries(ir),
  };
}

export function renameEndpointIrOp(
  ctx: Pick<SiteOpsContext, "registry">,
  siteId: string,
  args: { endpointId: string; suggestedName: string },
): Record<string, unknown> {
  const name = args.suggestedName.trim();
  if (!name) throw new Error("suggestedName is required");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
    throw new Error("suggestedName must be snake_case, max 64 chars");
  }
  const site = requireSite(ctx.registry, siteId);
  const ir = rebuildIr(
    site.observedActions ?? [],
    site.candidates,
    site.endpointIr ?? [],
  );
  const idx = ir.findIndex((e) => e.id === args.endpointId);
  if (idx < 0) throw new Error(`Endpoint IR not found: ${args.endpointId}`);
  const next = ir.map((e, i) =>
    i === idx ? { ...e, suggestedName: name } : e,
  );
  ctx.registry.update(siteId, { endpointIr: next });
  return {
    ok: true,
    endpoint: irSummaries([next[idx]!])[0],
  };
}

export function listCapabilityGraphOp(
  ctx: Pick<SiteOpsContext, "registry">,
  siteId: string,
): Record<string, unknown> {
  const site = requireSite(ctx.registry, siteId);
  const ir = rebuildIr(
    site.observedActions ?? [],
    site.candidates,
    site.endpointIr ?? [],
  );
  const primitives = upgradeTools(site.tools.filter((t) => t.approved !== false));
  const caps = listCapabilitiesForSite({ site, primitives });
  const graph = buildCapabilityGraph({
    endpointIr: ir,
    primitives: primitives.map((t) => ({ name: t.name, approved: t.approved })),
    capabilities: caps.map((c) => ({
      name: c.name,
      title: c.title,
      bind: c.bind,
    })),
  });
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    endpointIr: irSummaries(ir),
  };
}

export async function applyEndpointIrTests(opts: {
  site: McpSite;
  endpointIds?: string[];
  mutate?: boolean;
  confirm: boolean;
  replay: ReplayLike;
}): Promise<{
  preview: boolean;
  results: Array<{
    endpointId: string;
    suggestedName: string;
    lastContract: IrContractResult;
    lastMutation?: IrMutationResult;
  }>;
  endpointIr: McpSite["endpointIr"];
}> {
  const ir = rebuildIr(
    opts.site.observedActions ?? [],
    opts.site.candidates,
    opts.site.endpointIr ?? [],
  );
  const ids = opts.endpointIds?.length
    ? opts.endpointIds
    : ir.filter((e) => e.compiledPrimitive && e.kind !== "other").map((e) => e.id);
  if (ids.length === 0) {
    throw new Error("No compiled endpoint IR to test. compile_endpoints first.");
  }
  const results: Array<{
    endpointId: string;
    suggestedName: string;
    lastContract: IrContractResult;
    lastMutation?: IrMutationResult;
  }> = [];
  for (const id of ids) {
    const endpoint = ir.find((e) => e.id === id);
    if (!endpoint) throw new Error(`Endpoint IR not found: ${id}`);
    const { tool, candidate } = resolveToolForIr(
      endpoint,
      opts.site.tools,
      opts.site.candidates,
    );
    const lastContract = await testEndpointContract({
      ir: endpoint,
      tool,
      candidate,
      replay: opts.replay,
    });
    let lastMutation: IrMutationResult | undefined;
    if (opts.mutate) {
      lastMutation = await testEndpointMutation({
        ir: endpoint,
        tool,
        candidate,
        replay: opts.replay,
      });
    }
    results.push({
      endpointId: id,
      suggestedName: endpoint.suggestedName,
      lastContract,
      ...(lastMutation ? { lastMutation } : {}),
    });
  }
  if (!opts.confirm) {
    return {
      preview: true,
      results,
      endpointIr: opts.site.endpointIr ?? ir,
    };
  }
  const next = mergeTestEvidence(
    ir,
    results.map((r) => ({
      endpointId: r.endpointId,
      lastContract: r.lastContract,
      lastMutation: r.lastMutation,
    })),
  );
  return { preview: false, results, endpointIr: next };
}

export async function testEndpointIrOp(
  ctx: SiteOpsContext,
  siteId: string,
  args: {
    endpointIds?: string[];
    mutate?: boolean;
    confirm?: boolean;
  },
): Promise<Record<string, unknown>> {
  const site = requireSite(ctx.registry, siteId);
  const auth = ctx.vault.get(siteId);
  if (!auth) throw new Error("No auth session in vault — login first");
  const replayFn = createSiteReplay({
    site,
    onAuth: (snap) => ctx.vault.set(siteId, snap),
  });
  const result = await applyEndpointIrTests({
    site,
    endpointIds: args.endpointIds,
    mutate: args.mutate === true,
    confirm: args.confirm === true,
    replay: (tool, replayArgs) => replayFn(tool, replayArgs, auth),
  });
  if (!result.preview) {
    ctx.registry.update(siteId, { endpointIr: result.endpointIr });
  }
  return {
    ...result,
    next: result.preview
      ? "Preview only — evidence not written. Re-call test_endpoint_ir with confirm:true to persist lastContract/lastMutation."
      : "Evidence saved on IR. upsert_capability (optional endpointIrId / endpointIrIds) then try_capability.",
  };
}

export function upsertCapabilityOp(
  ctx: SiteOpsContext,
  siteId: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (args.confirm !== true) {
    return {
      preview: true,
      refused: true,
      next: "Pass confirm:true after the user agrees in chat to write this capability.",
      draft: {
        name: args.name,
        description: args.description,
        bind: args.bind,
      },
    };
  }
  const site = requireSite(ctx.registry, siteId);
  const adapter = resolveAdapter(site);
  const def = parseCapabilityUpsert(args);
  validateCapabilityDef(site, adapter, def);
  const formatWarning = capabilityFormatWarning(adapter, def);
  const existing = site.capabilities ?? [];
  const next = [...existing.filter((c) => c.name !== def.name), def];
  const updated = ctx.registry.update(site.id, { capabilities: next });
  const primitives = upgradeTools(updated.tools.filter((t) => t.approved));
  const effective = listCapabilitiesForSite({ site: updated, primitives });
  return {
    preview: false,
    capability: def,
    storedCount: next.length,
    effective: effective.map(capSummary),
    warning: formatWarning,
    next: formatWarning
      ? `${formatWarning} Then try_capability and register_site_mcp (confirm:true).`
      : "Call try_capability, then register_site_mcp with confirm:true. Reload MCP key in Cursor afterward.",
  };
}

export async function tryCapabilityOp(
  ctx: SiteOpsContext,
  siteId: string,
  args: { name: string; args?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const site = requireSite(ctx.registry, siteId);
  const auth = ctx.vault.get(siteId);
  if (!auth) throw new Error("No auth session in vault — login first");
  const capName = String(args.name ?? "").trim();
  if (!capName) throw new Error("name is required");
  const capArgs = args.args ?? {};
  const primitives = upgradeTools(site.tools.filter((t) => t.approved));
  const cap = getCapability({ site, primitives }, capName);
  if (!cap) throw new Error(`Unknown capability: ${capName}`);
  try {
    const result = await cap.execute(
      {
        site,
        auth,
        primitives,
        replay: createSiteReplay({
          site,
          onAuth: (snap) => ctx.vault.set(siteId, snap),
        }),
      },
      capArgs,
    );
    return {
      isError: Boolean(result.isError),
      text: result.content[0]?.text,
      ...(result.structuredContent ?? {}),
    };
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return { isError: true, text: err.message };
    }
    throw err;
  }
}

export function registerSiteMcpOp(
  ctx: SiteOpsContext,
  siteId: string,
  args: { confirm?: boolean },
): Record<string, unknown> {
  if (args.confirm !== true) {
    return {
      preview: true,
      refused: true,
      next: "Pass confirm:true after the user agrees to write ~/.cursor/mcp.json.",
    };
  }
  const site = requireSite(ctx.registry, siteId);
  if (site.tools.filter((t) => t.approved).length === 0) {
    throw new Error("Approve at least one tool before registering");
  }
  const entry = buildMcpEntry(site, {
    runtimeEntry: ctx.runtimeEntry,
    dataDir: ctx.dataDir,
    masterKey: ctx.masterKey,
  });
  const mcpPath = defaultCursorMcpPath();
  mergeCursorMcpConfig(mcpPath, site.cursorMcpKey, entry);
  const after = nextAfterRegister({ site, mcpKey: site.cursorMcpKey });
  return {
    preview: false,
    ok: true,
    mcpPath,
    key: site.cursorMcpKey,
    message: after.message,
    ...(after.warning ? { warning: after.warning } : {}),
    capabilities: after.capabilities,
  };
}
