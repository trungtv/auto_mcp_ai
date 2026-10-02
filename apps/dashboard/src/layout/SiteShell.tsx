import { NavLink, Outlet, Link, useParams } from "react-router-dom";
import { useSiteSession } from "../hooks/useAppSession";
import { api } from "../api";

const TABS = [
  { to: "overview", label: "Overview" },
  { to: "mcp", label: "MCP" },
  { to: "ir", label: "IR" },
  { to: "explore", label: "Explore" },
  { to: "tools", label: "Tools" },
] as const;

export function SiteShell() {
  const { siteId } = useParams<{ siteId: string }>();
  const {
    site,
    sites,
    busy,
    awaitingLoginConfirm,
    runSafe,
    setMessage,
    setSiteAuth,
    refresh,
  } = useSiteSession(siteId);

  if (!siteId) {
    return <p className="empty">Thiếu site id.</p>;
  }

  if (!site) {
    if (sites.length === 0 && !busy) {
      return (
        <div className="panel site-missing">
          <p className="empty">Đang tải servers…</p>
        </div>
      );
    }
    return (
      <div className="panel site-missing">
        <p className="empty">Không tìm thấy site.</p>
        <Link to="/">← Servers</Link>
      </div>
    );
  }

  return (
    <div className="site-shell">
      <div className="site-shell-head">
        <div className="site-shell-title">
          <Link to="/" className="back-link">
            ← Servers
          </Link>
          <h1>{site.name}</h1>
          <span className={`status ${site.status}`}>{site.status}</span>
        </div>
        <nav className="site-tabs" aria-label="Site sections">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={`/sites/${siteId}/${tab.to}`}
              className={({ isActive }) =>
                isActive ? "site-tab active" : "site-tab"
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {awaitingLoginConfirm ? (
        <div className="login-confirm login-confirm-strip">
          <div>
            <strong>Đang chờ xác nhận đăng nhập</strong>
            <p>
              Đăng nhập trong cửa sổ Chromium, rồi bấm xác nhận (hoặc mở tab Overview).
            </p>
          </div>
          <div className="login-confirm-actions">
            <button
              type="button"
              className="primary"
              disabled={!!busy}
              onClick={() =>
                runSafe("login-confirm", async () => {
                  await api.loginConfirm(site.id);
                  setSiteAuth(site.id, { awaitingLoginConfirm: false, hasAuth: true });
                  setMessage("Đã capture session.");
                  await refresh(site.id);
                })
              }
            >
              Đã đăng nhập xong
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                runSafe("login-cancel", async () => {
                  await api.loginCancel(site.id);
                  setSiteAuth(site.id, { awaitingLoginConfirm: false });
                  setMessage("Đã hủy phiên đăng nhập.");
                })
              }
            >
              Hủy
            </button>
          </div>
        </div>
      ) : null}

      <div className="site-shell-body panel">
        <Outlet />
      </div>
    </div>
  );
}
