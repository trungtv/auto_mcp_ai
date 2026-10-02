import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSiteSession } from "../hooks/useAppSession";
import {
  IrRow,
  type IrFilter,
  useIrDerived,
} from "./overviewBits";

export function SiteIrPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { site } = useSiteSession(siteId);
  const [irFilter, setIrFilter] = useState<IrFilter>("active");
  const [irQuery, setIrQuery] = useState("");

  const { ir, boundIrIds, irStats } = useIrDerived(
    site?.endpointIr,
    site?.capabilities ?? [],
  );

  const filteredIr = useMemo(() => {
    const q = irQuery.trim().toLowerCase();
    return ir.filter((e) => {
      if (irFilter === "active" && !(e.compiledPrimitive || boundIrIds.has(e.id))) {
        return false;
      }
      if (irFilter === "compiled" && !e.compiledPrimitive) return false;
      if (irFilter === "data_api" && e.kind !== "data_api") return false;
      if (!q) return true;
      return `${e.suggestedName} ${e.method} ${e.urlTemplate} ${e.compiledPrimitive ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [ir, irFilter, irQuery, boundIrIds]);

  if (!site) return null;

  return (
    <div className="page-overview">
      <div className="overview-section-head">
        <h3>Endpoint IR</h3>
        <span className="overview-count">
          {filteredIr.length}/{irStats.total}
        </span>
      </div>
      <div className="overview-ir-controls">
        {(
          [
            ["active", `Đang dùng (${irStats.active})`],
            ["compiled", `Compiled (${irStats.compiled})`],
            ["data_api", `data_api (${irStats.dataApi})`],
            ["all", `Tất cả (${irStats.total})`],
          ] as Array<[IrFilter, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip ${irFilter === id ? "active" : ""}`}
            onClick={() => setIrFilter(id)}
          >
            {label}
          </button>
        ))}
        <input
          className="overview-ir-search"
          type="search"
          placeholder="Lọc tên / URL…"
          value={irQuery}
          onChange={(e) => setIrQuery(e.target.value)}
        />
      </div>
      {irStats.total === 0 ? (
        <p className="empty">
          Chưa có IR — <Link to={`/sites/${site.id}/explore`}>Explore</Link> để
          bắt API.
        </p>
      ) : filteredIr.length === 0 ? (
        <p className="empty">Không khớp bộ lọc.</p>
      ) : (
        <div className="overview-table-wrap overview-ir-table">
          <table className="overview-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Name</th>
                <th>Kind</th>
                <th>Compile</th>
                <th>Contract</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {filteredIr.map((e) => (
                <IrRow key={e.id} endpoint={e} bound={boundIrIds.has(e.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
