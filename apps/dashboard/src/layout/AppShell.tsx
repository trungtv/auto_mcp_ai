import { Link, Outlet } from "react-router-dom";
import { useAppSession } from "../hooks/useAppSession";

export function AppShell() {
  const { error, message, busy, cursorSdk } = useAppSession();

  return (
    <div className="app app-wide app-shell">
      <header className="topbar">
        <Link to="/" className="topbar-brand">
          auto_mcp_ai
        </Link>
        <span className="topbar-meta">
          {cursorSdk ? "Cursor SDK ready" : "manual-only"}
          {busy ? ` · ${busy}…` : ""}
        </span>
      </header>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="ok">{message}</div> : null}

      <Outlet />
    </div>
  );
}
