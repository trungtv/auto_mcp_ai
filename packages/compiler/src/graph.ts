import {
  boundEndpointIrIds,
  type CapabilityBind,
  type EndpointIr,
  type IrContractResult,
  type IrMutationResult,
} from "@auto-mcp/shared";

export type GraphNodeKind = "ir" | "primitive" | "capability";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  extra?: Record<string, unknown>;
};

export type GraphEdgeKind = "ir_compiled" | "cap_bind" | "cap_ir";

export type GraphEdge = {
  kind: GraphEdgeKind;
  from: string;
  to: string;
};

export type CapabilityGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphCapability = {
  name: string;
  title?: string;
  bind?: CapabilityBind;
};

export type GraphPrimitive = {
  name: string;
  approved?: boolean;
};

function primitiveNamesFromBind(
  bind: CapabilityBind | undefined,
  catalog: EndpointIr[],
): string[] {
  if (!bind) return [];
  if (bind.kind === "pipeline") return bind.steps.map((s) => s.primitive);
  const names = new Set<string>([bind.primitive]);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  for (const id of boundEndpointIrIds(bind)) {
    const compiled = byId.get(id)?.compiledPrimitive;
    if (compiled) names.add(compiled);
  }
  return [...names];
}

export function buildCapabilityGraph(opts: {
  endpointIr: EndpointIr[];
  primitives: GraphPrimitive[];
  capabilities: GraphCapability[];
}): CapabilityGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };

  const irs = opts.endpointIr.filter((e) => e.kind !== "other");
  for (const e of irs) {
    addNode({
      id: `ir:${e.id}`,
      kind: "ir",
      label: e.suggestedName,
      extra: {
        key: e.key,
        kind: e.kind,
        compiledPrimitive: e.compiledPrimitive,
        lastContractOk: e.lastContract?.ok,
        lastMutationOk: e.lastMutation?.ok,
      },
    });
  }

  for (const p of opts.primitives) {
    if (p.approved === false) continue;
    addNode({
      id: `prim:${p.name}`,
      kind: "primitive",
      label: p.name,
    });
  }

  const irByCompiled = new Map<string, EndpointIr[]>();
  for (const e of irs) {
    if (!e.compiledPrimitive) continue;
    const list = irByCompiled.get(e.compiledPrimitive) ?? [];
    list.push(e);
    irByCompiled.set(e.compiledPrimitive, list);
  }

  for (const c of opts.capabilities) {
    addNode({
      id: `cap:${c.name}`,
      kind: "capability",
      label: c.title ?? c.name,
    });
    const prims = primitiveNamesFromBind(c.bind, irs);
    for (const name of prims) {
      addNode({ id: `prim:${name}`, kind: "primitive", label: name });
      edges.push({
        kind: "cap_bind",
        from: `cap:${c.name}`,
        to: `prim:${name}`,
      });
      for (const ir of irByCompiled.get(name) ?? []) {
        edges.push({
          kind: "cap_ir",
          from: `cap:${c.name}`,
          to: `ir:${ir.id}`,
        });
      }
    }
    for (const irId of c.bind ? boundEndpointIrIds(c.bind) : []) {
      const ir = irs.find((e) => e.id === irId);
      if (!ir) continue;
      const already = edges.some(
        (ed) =>
          ed.kind === "cap_ir" &&
          ed.from === `cap:${c.name}` &&
          ed.to === `ir:${ir.id}`,
      );
      if (!already) {
        edges.push({
          kind: "cap_ir",
          from: `cap:${c.name}`,
          to: `ir:${ir.id}`,
        });
      }
    }
  }

  for (const e of irs) {
    if (!e.compiledPrimitive) continue;
    addNode({
      id: `prim:${e.compiledPrimitive}`,
      kind: "primitive",
      label: e.compiledPrimitive,
    });
    edges.push({
      kind: "ir_compiled",
      from: `ir:${e.id}`,
      to: `prim:${e.compiledPrimitive}`,
    });
  }

  return { nodes, edges };
}

export function mergeTestEvidence(
  ir: EndpointIr[],
  evidence: Array<{
    endpointId: string;
    lastContract?: IrContractResult;
    lastMutation?: IrMutationResult;
  }>,
): EndpointIr[] {
  const byId = new Map(evidence.map((e) => [e.endpointId, e]));
  return ir.map((e) => {
    const patch = byId.get(e.id);
    if (!patch) return e;
    return {
      ...e,
      ...(patch.lastContract ? { lastContract: patch.lastContract } : {}),
      ...(patch.lastMutation ? { lastMutation: patch.lastMutation } : {}),
    };
  });
}
