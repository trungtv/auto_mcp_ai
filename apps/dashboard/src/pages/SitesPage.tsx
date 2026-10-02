import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAppSession } from "../hooks/useAppSession";

export function SitesPage() {
  const { sites, busy, runSafe, setMessage, refresh } = useAppSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  function onCreate(e: FormEvent) {
    e.preventDefault();
    runSafe("create", async () => {
      const { site } = await api.createSite({ name: name.trim(), baseUrl: baseUrl.trim() });
      setMessage(`Đã thêm ${site.name}`);
      await refresh();
      navigate(`/sites/${site.id}/overview`);
    });
  }

  return (
    <div className="sites-page">
      <div className="sites-page-grid">
        <section className="panel">
          <h2>Servers</h2>
          <ul className="site-list">
            {sites.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/sites/${s.id}/overview`}
                  className="site-item site-item-link"
                >
                  <span className="name">{s.name}</span>
                  <span className="url">{s.baseUrl}</span>
                  <span className={`status ${s.status}`}>{s.status}</span>
                  <span className="site-item-key">
                    <code>{s.cursorMcpKey}</code>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {sites.length === 0 ? (
            <p className="empty">Chưa có server. Thêm website bên phải.</p>
          ) : null}
        </section>

        <section className="panel">
          <form className="add-form" onSubmit={onCreate}>
            <h2>Add website</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên"
              required
            />
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://…"
              type="url"
              required
            />
            <button className="primary" type="submit" disabled={!!busy}>
              Thêm
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
