import { useParams } from "react-router-dom";
import { api } from "../api";
import { ToolsWorkspace } from "../ToolsWorkspace";
import { useSiteSession } from "../hooks/useAppSession";

export function SiteToolsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const {
    site,
    busy,
    hasAuth,
    run,
    setError,
    setMessage,
    refresh,
  } = useSiteSession(siteId);

  if (!site) return null;

  return (
    <div className="page-tools">
      <ToolsWorkspace
        site={site}
        hasAuth={hasAuth}
        busy={!!busy}
        onError={setError}
        onMessage={setMessage}
        onApprove={async (body) => {
          await run("approve", async () => {
            await api.approve(site.id, body);
            await refresh(site.id);
          });
        }}
      />
    </div>
  );
}
