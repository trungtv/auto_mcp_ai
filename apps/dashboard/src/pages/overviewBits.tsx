import {
  boundEndpointIrIds,
  type CapabilityBind,
  type EndpointIr,
} from "@auto-mcp/shared";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

export type CapRow = {
  name: string;
  title?: string;
  supportsMutation: boolean;
  bind?: CapabilityBind;
};

export type IrFilter = "active" | "compiled" | "data_api" | "all";

export type IrStats = {
  total: number;
  compiled: number;
  contracted: number;
  dataApi: number;
  active: number;
};

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

export function bindSummary(bind: CapabilityBind | undefined): {
  kind: string;
  primitive: string;
  format?: string;
  irIds: string[];
} {
  if (!bind) return { kind: "—", primitive: "—", irIds: [] };
  if (bind.kind === "pipeline") {
    return {
      kind: "pipeline",
      primitive: bind.steps.map((s) => s.primitive).join(" → "),
      format: bind.format,
      irIds: [],
    };
  }
  return {
    kind: bind.endpointIrIds?.length
      ? `1:${bind.endpointIrIds.length} IR`
      : bind.endpointIrId
        ? "IR"
        : "primitive",
    primitive: bind.primitive,
    format: bind.format,
    irIds: boundEndpointIrIds(bind),
  };
}

export function useSiteCaps(
  siteId: string | undefined,
  rev: string,
): {
  adapterId: string;
  primitiveCount: number;
  capabilities: CapRow[];
} | null {
  const [caps, setCaps] = useState<{
    adapterId: string;
    primitiveCount: number;
    capabilities: CapRow[];
  } | null>(null);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    void api
      .getCapabilities(siteId)
      .then((r) => {
        if (!cancelled) {
          setCaps({
            adapterId: r.adapterId,
            primitiveCount: r.primitiveCount,
            capabilities: r.capabilities.map((c) => ({
              name: c.name,
              title: c.title,
              supportsMutation: c.supportsMutation,
              bind: c.bind as CapabilityBind | undefined,
            })),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCaps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, rev]);

  return caps;
}

export function useIrDerived(endpointIr: EndpointIr[] | undefined, capabilities: Array<{ bind: CapabilityBind }>) {
  const ir = endpointIr ?? [];
  const boundIrIds = useMemo(() => {
    const ids = new Set<string>();
    for (const cap of capabilities) {
      for (const id of boundEndpointIrIds(cap.bind)) ids.add(id);
    }
    return ids;
  }, [capabilities]);

  const irStats: IrStats = useMemo(() => {
    const compiled = ir.filter((e) => e.compiledPrimitive).length;
    const contracted = ir.filter((e) => e.lastContract?.ok).length;
    const dataApi = ir.filter((e) => e.kind === "data_api").length;
    const active = ir.filter(
      (e) => Boolean(e.compiledPrimitive) || boundIrIds.has(e.id),
    ).length;
    return { total: ir.length, compiled, contracted, dataApi, active };
  }, [ir, boundIrIds]);

  return { ir, boundIrIds, irStats };
}

export function Stat(props: {
  value: string | number;
  label: string;
  hint?: string;
  tone?: "ok" | "warn";
  active?: boolean;
  onClick?: () => void;
}) {
  const className = [
    "overview-stat",
    props.tone ? `tone-${props.tone}` : "",
    props.active ? "active" : "",
    props.onClick ? "clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inner = (
    <>
      <div className="overview-stat-value">{props.value}</div>
      <div className="overview-stat-label">{props.label}</div>
      {props.hint ? <div className="overview-stat-hint">{props.hint}</div> : null}
    </>
  );
  if (props.onClick) {
    return (
      <button type="button" className={className} onClick={props.onClick}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

export function IrRow(props: { endpoint: EndpointIr; bound: boolean }) {
  const e = props.endpoint;
  const methodClass = `method-badge method-${e.method.toLowerCase()}`;
  return (
    <tr>
      <td>
        <span className={methodClass}>{e.method}</span>
      </td>
      <td>
        <code>{e.suggestedName}</code>
        {props.bound ? <span className="chip chip-ok">bound</span> : null}
      </td>
      <td>
        <span className={`chip ${e.kind === "other" ? "chip-warn" : "chip-sem"}`}>
          {e.kind}
        </span>
      </td>
      <td>
        {e.compiledPrimitive ? (
          <span className="chip chip-ok">{e.compiledPrimitive}</span>
        ) : (
          <span className="muted">chưa</span>
        )}
      </td>
      <td>
        {e.lastContract ? (
          <span className={`chip ${e.lastContract.ok ? "chip-ok" : "chip-warn"}`}>
            {e.lastContract.ok ? "ok" : "fail"}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
        {e.lastMutation ? (
          <span className={`chip ${e.lastMutation.ok ? "chip-ok" : "chip-warn"}`}>
            mut {e.lastMutation.ok ? "ok" : "fail"}
          </span>
        ) : null}
      </td>
      <td>
        <code className="ir-path" title={e.urlTemplate}>
          {pathOf(e.urlTemplate)}
          {e.params.length ? `?${e.params.map((p) => p.name).join("&")}` : ""}
        </code>
      </td>
    </tr>
  );
}
