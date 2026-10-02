import { Navigate, Route, Routes } from "react-router-dom";
import { AppSessionProvider } from "./hooks/useAppSession";
import { AppShell } from "./layout/AppShell";
import { SiteShell } from "./layout/SiteShell";
import { SiteExplorePage } from "./pages/SiteExplorePage";
import { SiteIrPage } from "./pages/SiteIrPage";
import { SiteMcpPage } from "./pages/SiteMcpPage";
import { SiteOverviewPage } from "./pages/SiteOverviewPage";
import { SitesPage } from "./pages/SitesPage";
import { SiteToolsPage } from "./pages/SiteToolsPage";

export function App() {
  return (
    <AppSessionProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<SitesPage />} />
          <Route path="sites/:siteId" element={<SiteShell />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<SiteOverviewPage />} />
            <Route path="mcp" element={<SiteMcpPage />} />
            <Route path="ir" element={<SiteIrPage />} />
            <Route path="explore" element={<SiteExplorePage />} />
            <Route path="tools" element={<SiteToolsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppSessionProvider>
  );
}
