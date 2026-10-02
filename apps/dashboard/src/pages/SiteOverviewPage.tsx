import { useRef } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import {
  CursorMcpPanel,
  type CursorMcpPanelHandle,
} from "../CursorMcpPanel";
import { useSiteSession } from "../hooks/useAppSession";
import { Stat, useIrDerived, useSiteCaps, type IrStats } from "./overviewBits";

export function SiteOverviewPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const legacyTab = searchParams.get("tab");
  const {
    site,
    busy,
    hasAuth,
    awaitingLoginConfirm,
    runSafe,
    setMessage,
    setSiteAuth,
    refresh,
  } = useSiteSession(siteId);
  const mcpPanelRef = useRef<CursorMcpPanelHandle>(null);
  const caps = useSiteCaps(
    siteId,
    `${site?.tools.length ?? 0}:${site?.capabilities?.length ?? 0}`,
  );
  const { irStats } = useIrDerived(site?.endpointIr, site?.capabilities ?? []);

  if (legacyTab === "ir") {
    return <Navigate to={`/sites/${siteId}/ir`} replace />;
  }
  if (legacyTab === "mcp") {
    return <Navigate to={`/sites/${siteId}/mcp`} replace />;
  }

  if (!site) return null;

  const canRegister = site.tools.length > 0;
  const mcpCount = caps?.capabilities.length ?? 0;
  const next = nextStep({
    siteId: site.id,
    hasAuth,
    awaitingLoginConfirm,
    irStats,
    mcpCount,
    toolCount: site.tools.length,
  });

  return (
    <div className="page-overview">
      <div className="overview-stats">
        <Stat
          value={mcpCount || "—"}
          label="MCP tools (Cursor)"
          hint={caps?.adapterId}
          onClick={() => navigate(`/sites/${site.id}/mcp`)}
        />
        <Stat
          value={`${irStats.compiled}/${irStats.total || "—"}`}
          label="IR đã compile"
          hint={irStats.total ? `${irStats.dataApi} data_api` : undefined}
          onClick={() => navigate(`/sites/${site.id}/ir`)}
        />
        <Stat
          value={irStats.contracted}
          label="Contract ok"
          tone={irStats.contracted > 0 ? "ok" : undefined}
          onClick={() => navigate(`/sites/${site.id}/ir`)}
        />
        <Stat
          value={site.tools.length}
          label="Primitives"
          hint={`${site.candidates.length} candidates`}
          onClick={() => navigate(`/sites/${site.id}/tools`)}
        />
        <Stat
          value={hasAuth ? "vault" : "chưa"}
          label="Auth"
          tone={hasAuth ? "ok" : "warn"}
        />
      </div>

      {next ? (
        <p className={`overview-next ${next.tone}`}>
          <strong>{next.title}</strong>
          <span>{next.body}</span>
          {next.to ? (
            <Link to={next.to} className="overview-next-link">
              {next.linkLabel}
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="overview-meta-row">
        <span>
          <span className="meta-label">URL</span>
          <code>{site.baseUrl}</code>
        </span>
        <span>
          <span className="meta-label">MCP key</span>
          <code>{site.cursorMcpKey}</code>
        </span>
        <span>
          <span className="meta-label">Explore</span>
          <code>{site.explorePath}</code>
        </span>
        <span className="replay-mode-row">
          <span className="meta-label">Replay</span>
          <span
            className={`chip ${site.replayMode === "browser" ? "chip-ok" : "chip-sem"}`}
          >
            {site.replayMode === "browser" ? "browser" : "http"}
          </span>
          <button
            type="button"
            className="ghost"
            disabled={!!busy}
            title={
              site.replayMode === "browser"
                ? "Chuyển về snapshot fetch (cookie/session dài)"
                : "Playwright warm-up SPA — dùng cho OIDC/TCB"
            }
            onClick={() =>
              runSafe("replay-mode", async () => {
                const nextMode =
                  site.replayMode === "browser" ? "http" : "browser";
                await api.setReplayMode(site.id, nextMode);
                setMessage(
                  nextMode === "browser"
                    ? "Replay mode: browser (warm-up SPA + Bearer mới)."
                    : "Replay mode: http (snapshot fetch).",
                );
                await refresh(site.id);
              })
            }
          >
            {site.replayMode === "browser" ? "Dùng HTTP" : "Dùng browser"}
          </button>
        </span>
      </div>

      <div className="toolbar overview-toolbar">
        <button
          type="button"
          className="primary"
          disabled={!!busy || awaitingLoginConfirm}
          onClick={() =>
            runSafe("login", async () => {
              const r = await api.login(site.id);
              setSiteAuth(site.id, { awaitingLoginConfirm: true });
              setMessage(r.message);
            })
          }
        >
          {site.status === "expired" || site.status === "needs_auth"
            ? "Đăng nhập"
            : "Đăng nhập lại"}
        </button>
        <button
          type="button"
          disabled={!!busy || !canRegister}
          title={
            canRegister
              ? "Ghi entry site vào ~/.cursor/mcp.json"
              : "Approve ít nhất một tool trước khi Register in Cursor"
          }
          onClick={() =>
            runSafe("register", async () => {
              const r = await api.registerCursor(site.id);
              setMessage(`Đã ghi ${r.key} vào ${r.mcpPath}`);
              await refresh(site.id);
              await mcpPanelRef.current?.refresh();
            })
          }
        >
          Register in Cursor
        </button>
        <button
          type="button"
          className="danger"
          disabled={!!busy}
          onClick={() =>
            runSafe("delete", async () => {
              await api.deleteSite(site.id);
              setMessage("Đã xóa server.");
              navigate("/");
              await refresh();
            })
          }
        >
          Xóa
        </button>
      </div>

      <CursorMcpPanel
        ref={mcpPanelRef}
        siteId={site.id}
        disabled={!!busy}
      />
    </div>
  );
}

function nextStep(opts: {
  siteId: string;
  hasAuth: boolean;
  awaitingLoginConfirm: boolean;
  irStats: IrStats;
  mcpCount: number;
  toolCount: number;
}): { title: string; body: string; tone: string; to?: string; linkLabel?: string } | null {
  if (opts.awaitingLoginConfirm) return null;
  if (!opts.hasAuth) {
    return {
      title: "Chưa có session",
      body: "Đăng nhập rồi Explore để bắt API.",
      tone: "warn",
      to: `/sites/${opts.siteId}/explore`,
      linkLabel: "Mở Explore",
    };
  }
  if (opts.irStats.compiled > 0 && opts.irStats.contracted === 0) {
    return {
      title: "IR đã compile, chưa test",
      body: "Gọi test_endpoint_ir confirm:true trước khi bind capability.",
      tone: "warn",
      to: `/sites/${opts.siteId}/ir`,
      linkLabel: "Mở IR",
    };
  }
  if (opts.irStats.total > 0 && opts.irStats.compiled === 0) {
    return {
      title: `${opts.irStats.dataApi} data_api chưa compile`,
      body: "Dùng compile_endpoints trên MCP control, hoặc duyệt catalog IR.",
      tone: "info",
      to: `/sites/${opts.siteId}/ir`,
      linkLabel: "Mở IR",
    };
  }
  if (opts.mcpCount > 0 && opts.toolCount > 0) {
    return {
      title: "Sẵn sàng trên Cursor",
      body: "Reload MCP site nếu vừa Register. Tab MCP = tool agent gọi; tab IR = endpoint đã quan sát.",
      tone: "ok",
      to: `/sites/${opts.siteId}/mcp`,
      linkLabel: "Mở MCP",
    };
  }
  return null;
}
