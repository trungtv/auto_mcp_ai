import { useParams } from "react-router-dom";
import { api } from "../api";
import { ChatPanel } from "../ChatPanel";
import { useSiteSession } from "../hooks/useAppSession";

export function SiteExplorePage() {
  const { siteId } = useParams<{ siteId: string }>();
  const {
    site,
    busy,
    hasAuth,
    awaitingLoginConfirm,
    cursorSdk,
    runSafe,
    setError,
    setMessage,
    upsertSite,
    refresh,
  } = useSiteSession(siteId);

  if (!site) return null;

  return (
    <div className="page-explore">
      <div className="toolbar">
        <button
          type="button"
          disabled={!!busy || !hasAuth}
          title="Passive capture: mở explorePath và bắt XHR (~8s)"
          onClick={() =>
            runSafe("quick-scan", async () => {
              const r = await api.explore(site.id);
              setMessage(
                `Quick scan: +${r.added ?? 0} mới, tổng ${r.candidateCount} candidates.`,
              );
              await refresh(site.id);
            })
          }
        >
          Quick scan
        </button>
        <button
          type="button"
          disabled={!!busy || site.candidates.length === 0 || !cursorSdk}
          title={
            cursorSdk
              ? "Đề xuất tools bằng Cursor SDK"
              : "Cần CURSOR_API_KEY — dùng Manual select ở tab Tools"
          }
          onClick={() =>
            runSafe("propose", async () => {
              const r = await api.propose(site.id);
              setMessage(`AI đề xuất ${r.proposed.length} tools.`);
              await refresh(site.id);
            })
          }
        >
          AI propose
        </button>
      </div>

      <ChatPanel
        site={site}
        cursorSdk={cursorSdk}
        hasAuth={hasAuth}
        disabled={!!busy || awaitingLoginConfirm}
        onError={(msg) => setError(msg)}
        onSiteUpdate={(s) => upsertSite(s)}
      />
    </div>
  );
}
