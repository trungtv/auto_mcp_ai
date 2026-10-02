import { Link, useParams } from "react-router-dom";
import { useSiteSession } from "../hooks/useAppSession";
import { bindSummary, useSiteCaps } from "./overviewBits";

export function SiteMcpPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { site } = useSiteSession(siteId);
  const caps = useSiteCaps(
    siteId,
    `${site?.tools.length ?? 0}:${site?.capabilities?.length ?? 0}`,
  );

  if (!site) return null;

  const ir = site.endpointIr ?? [];
  const list = caps?.capabilities ?? [];

  return (
    <div className="page-overview">
      <div className="overview-section-head">
        <h3>MCP business tools</h3>
        <span className="overview-count">
          {list.length} tool{caps?.adapterId ? ` · ${caps.adapterId}` : ""}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="empty">
          Chưa có capability — compile IR rồi upsert, hoặc approve pack seeds.{" "}
          <Link to={`/sites/${site.id}/ir`}>Mở IR</Link>
        </p>
      ) : (
        <div className="overview-table-wrap">
          <table className="overview-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Bind</th>
                <th>Primitive</th>
                <th>IR</th>
                <th>Format</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const b = bindSummary(c.bind);
                const irNames = b.irIds.map((id) => {
                  const hit = ir.find((e) => e.id === id);
                  return hit?.suggestedName ?? id;
                });
                return (
                  <tr key={c.name}>
                    <td>
                      <code>{c.name}</code>
                      {c.title ? (
                        <div className="cap-title muted">{c.title}</div>
                      ) : null}
                      {c.supportsMutation ? (
                        <span className="chip chip-sem">mutable</span>
                      ) : null}
                    </td>
                    <td>
                      <span className="chip chip-sem">{b.kind}</span>
                    </td>
                    <td>
                      <code className="cell-mono">{b.primitive}</code>
                    </td>
                    <td>
                      {irNames.length ? (
                        irNames.map((n) => (
                          <span key={n} className="chip chip-ok">
                            {n}
                          </span>
                        ))
                      ) : (
                        <span className="muted">pack</span>
                      )}
                    </td>
                    <td>
                      {b.format ? (
                        <code className="cell-mono">{b.format}</code>
                      ) : (
                        <span className="muted">raw</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
