import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { api, type McpSite } from "./api";
import { SchemaForm, useSchemaArgs } from "./SchemaForm";
import { ToolDetailPanel } from "./ToolDetailPanel";
import {
  filterRows,
  rowsFromSite,
  shortUrl,
  type CatalogRow,
  type PipelineStatus,
} from "./toolDisplay";

type Segment = "all" | PipelineStatus;
type ViewMode = "mcp" | "pipeline";

type CapabilityInfo = {
  name: string;
  title?: string;
  description: string;
  supportsMutation: boolean;
  inputSchema: Record<string, unknown>;
  bind?: Record<string, unknown>;
};

type Props = {
  site: McpSite;
  hasAuth: boolean;
  busy: boolean;
  onApprove: (body: {
    candidateIds?: string[];
    toolNames?: string[];
  }) => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
};

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "all", label: "All" },
  { id: "candidate", label: "Candidates" },
  { id: "proposed", label: "Proposed" },
  { id: "approved", label: "Approved" },
];

export function ToolsWorkspace({
  site,
  hasAuth,
  busy,
  onApprove,
  onError,
  onMessage,
}: Props) {
  const [view, setView] = useState<ViewMode>("mcp");
  const [segment, setSegment] = useState<Segment>("all");
  const [method, setMethod] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCap, setSelectedCap] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [adapterId, setAdapterId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const allRows = useMemo(() => rowsFromSite(site), [site]);
  const methods = useMemo(() => {
    const set = new Set(allRows.map((r) => r.method));
    return [...set].sort();
  }, [allRows]);

  const rows = useMemo(
    () => filterRows(allRows, { segment, method, query }),
    [allRows, segment, method, query],
  );

  const selected = useMemo(
    () => allRows.find((r) => r.key === selectedKey) ?? null,
    [allRows, selectedKey],
  );

  const activeCap = useMemo(
    () => capabilities.find((c) => c.name === selectedCap) ?? null,
    [capabilities, selectedCap],
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .getCapabilities(site.id)
      .then((r) => {
        if (cancelled) return;
        setAdapterId(r.adapterId);
        setCapabilities(
          r.capabilities.map((c) => ({
            name: c.name,
            title: c.title,
            description: c.description,
            supportsMutation: c.supportsMutation,
            inputSchema: c.inputSchema,
            bind: c.bind,
          })),
        );
        setSelectedCap((prev) => prev ?? r.capabilities[0]?.name ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setAdapterId(null);
        setCapabilities([]);
        onError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [site.id, site.tools, site.capabilities, onError]);

  useEffect(() => {
    if (selectedKey && !allRows.some((r) => r.key === selectedKey)) {
      setSelectedKey(rows[0]?.key ?? null);
    } else if (!selectedKey && rows[0]) {
      setSelectedKey(rows[0].key);
    }
  }, [allRows, rows, selectedKey]);

  useEffect(() => {
    setChecked(new Set());
  }, [site.id]);

  const counts = useMemo(() => {
    const c = { all: allRows.length, candidate: 0, proposed: 0, approved: 0 };
    for (const r of allRows) c[r.status] += 1;
    return c;
  }, [allRows]);

  const toggleCheck = useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const checkedRows = useMemo(
    () => allRows.filter((r) => checked.has(r.key)),
    [allRows, checked],
  );

  async function approveChecked() {
    const candidateIds = checkedRows
      .filter((r) => r.status === "candidate" && r.candidateId)
      .map((r) => r.candidateId!);
    const toolNames = checkedRows
      .filter((r) => r.status === "proposed")
      .map((r) => r.name);
    if (candidateIds.length === 0 && toolNames.length === 0) {
      onError("Chỉ approve được candidates hoặc proposed tools.");
      return;
    }
    try {
      await onApprove({
        candidateIds: candidateIds.length ? candidateIds : undefined,
        toolNames: toolNames.length ? toolNames : undefined,
      });
      setChecked(new Set());
      onMessage(
        `Đã approve ${candidateIds.length + toolNames.length} item(s).`,
      );
    } catch {
      /* error via onError / App setError */
    }
  }

  function moveSelection(delta: number) {
    if (view === "mcp") {
      if (capabilities.length === 0) return;
      const idx = capabilities.findIndex((c) => c.name === selectedCap);
      const next =
        idx < 0 ? 0 : Math.max(0, Math.min(capabilities.length - 1, idx + delta));
      setSelectedCap(capabilities[next]!.name);
      return;
    }
    if (rows.length === 0) return;
    const idx = rows.findIndex((r) => r.key === selectedKey);
    const next = idx < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + delta));
    setSelectedKey(rows[next]!.key);
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    }
  }

  return (
    <section className="section tools-workspace">
      <div className="tools-workspace-head">
        <h3>Tools</h3>
        <div className="view-mode-bar" role="tablist">
          <button
            type="button"
            role="tab"
            className={view === "mcp" ? "active" : undefined}
            aria-selected={view === "mcp"}
            onClick={() => setView("mcp")}
          >
            MCP (Cursor)
            <span className="count">{capabilities.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={view === "pipeline" ? "active" : undefined}
            aria-selected={view === "pipeline"}
            onClick={() => setView("pipeline")}
          >
            Pipeline
            <span className="count">{allRows.length}</span>
          </button>
        </div>
        <p className="tools-workspace-sub">
          {view === "mcp"
            ? `Agent thấy ${capabilities.length} tool này trên server \`${site.cursorMcpKey}\`${adapterId ? ` · adapter ${adapterId}` : ""}.`
            : "Candidates / proposed / primitives — explore & approve; không list ra Cursor khi có site adapter."}
        </p>
      </div>

      {view === "mcp" ? (
        <div className="tools-workspace-grid">
          <div
            className="tools-catalog"
            ref={listRef}
            tabIndex={0}
            onKeyDown={onListKeyDown}
          >
            {capabilities.length === 0 ? (
              <div className="catalog-empty">
                <p className="empty">
                  Chưa có MCP capability. Approve primitives lõi (get_classes,
                  get_course_members, get_projects…) ở tab Pipeline, rồi quay lại.
                </p>
                <button type="button" onClick={() => setView("pipeline")}>
                  Mở Pipeline
                </button>
              </div>
            ) : (
              <ul className="catalog-list">
                {capabilities.map((cap) => (
                  <li
                    key={cap.name}
                    className={
                      cap.name === selectedCap
                        ? "catalog-item active"
                        : "catalog-item"
                    }
                  >
                    <span className="check-spacer" />
                    <button
                      type="button"
                      className="catalog-item-main"
                      onClick={() => setSelectedCap(cap.name)}
                    >
                      <div className="catalog-item-top">
                        <span className="chip chip-mcp">MCP</span>
                        <strong className="catalog-name">{cap.name}</strong>
                        {cap.supportsMutation ? (
                          <span className="chip chip-sem">mutable</span>
                        ) : null}
                      </div>
                      <div className="catalog-item-meta">
                        {cap.title ? (
                          <span className="rpc-hint">{cap.title}</span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <CapabilityDetailPanel
            siteId={site.id}
            cap={activeCap}
            hasAuth={hasAuth}
            busy={busy}
            onError={onError}
          />
        </div>
      ) : (
        <div className="tools-workspace-grid">
          <div
            className="tools-catalog"
            ref={listRef}
            tabIndex={0}
            onKeyDown={onListKeyDown}
          >
            <div className="catalog-controls">
              <div className="primitives-label">
                Pipeline · {counts.approved} approved primitives
              </div>
              <input
                className="catalog-search"
                type="search"
                placeholder="Search name, url, rpc…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="segment-bar" role="tablist">
                {SEGMENTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={segment === s.id}
                    className={segment === s.id ? "active" : undefined}
                    onClick={() => setSegment(s.id)}
                  >
                    {s.label}
                    <span className="count">{counts[s.id]}</span>
                  </button>
                ))}
              </div>
              <div className="method-chips">
                <button
                  type="button"
                  className={method === "all" ? "chip active" : "chip"}
                  onClick={() => setMethod("all")}
                >
                  ALL
                </button>
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={method === m ? "chip active" : "chip"}
                    onClick={() => setMethod(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="catalog-empty">
                <p className="empty">
                  {allRows.length === 0
                    ? "Chưa có candidates/tools. Dùng Explore → Quick scan sau khi đăng nhập."
                    : "Không khớp filter hiện tại."}
                </p>
              </div>
            ) : (
              <ul className="catalog-list">
                {rows.map((r) => (
                  <CatalogItem
                    key={r.key}
                    row={r}
                    active={r.key === selectedKey}
                    checked={checked.has(r.key)}
                    onSelect={() => setSelectedKey(r.key)}
                    onToggle={() => toggleCheck(r.key)}
                  />
                ))}
              </ul>
            )}

            {checked.size > 0 ? (
              <div className="catalog-approve-bar">
                <span>
                  {checked.size} selected ·{" "}
                  {checkedRows.filter((r) => r.status !== "approved").length}{" "}
                  approvable
                </span>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void approveChecked()}
                >
                  Approve selected
                </button>
              </div>
            ) : null}
          </div>

          <ToolDetailPanel
            siteId={site.id}
            row={selected}
            hasAuth={hasAuth}
            busy={busy}
            onError={onError}
            onApproveCandidate={(candidateId) => {
              void onApprove({ candidateIds: [candidateId] })
                .then(() => onMessage("Đã approve candidate."))
                .catch(() => {
                  /* error via App setError */
                });
            }}
            onApproveProposed={(toolName) => {
              void onApprove({ toolNames: [toolName] })
                .then(() => onMessage(`Đã approve ${toolName}.`))
                .catch(() => {
                  /* error via App setError */
                });
            }}
          />
        </div>
      )}
    </section>
  );
}

function CapabilityDetailPanel({
  siteId,
  cap,
  hasAuth,
  busy,
  onError,
}: {
  siteId: string;
  cap: CapabilityInfo | null;
  hasAuth: boolean;
  busy: boolean;
  onError: (message: string) => void;
}) {
  const [args, setArgs] = useSchemaArgs(cap?.name ?? "");
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState<{
    status?: number;
    ok?: boolean;
    preview: string;
    meta: string;
    domainTable?: { headers: string[]; rows: string[][] };
  } | null>(null);
  const [tryError, setTryError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setTryError(null);
  }, [cap?.name]);

  if (!cap) {
    return (
      <div className="tool-detail empty-detail">
        <p className="empty">Chọn một MCP tool bên trái.</p>
      </div>
    );
  }

  async function onTry() {
    setTrying(true);
    setTryError(null);
    setResult(null);
    try {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== "") clean[k] = v;
      }
      const r = await api.tryCapability(siteId, cap!.name, clean);
      let domainTable: { headers: string[]; rows: string[][] } | undefined;
      if (Array.isArray(r.students) && r.students.length) {
        domainTable = {
          headers: ["MSSV", "Họ tên", "Email"],
          rows: r.students.map((s) => [
            String(s.studentId ?? ""),
            String(s.name ?? ""),
            String(s.email ?? ""),
          ]),
        };
      } else if (Array.isArray(r.projects) && r.projects.length) {
        domainTable = {
          headers: ["MSSV", "Sinh viên", "Mã HP", "Đề tài"],
          rows: r.projects.map((p) => [
            String(p.studentId ?? ""),
            String(p.studentName ?? ""),
            String(p.courseCode ?? ""),
            String(p.title ?? "").slice(0, 80),
          ]),
        };
      } else if (Array.isArray(r.classes) && r.classes.length) {
        domainTable = {
          headers: ["classId", "Mã HP", "Tên học phần"],
          rows: r.classes.map((c) => [
            String(c.classId ?? ""),
            String(c.courseCode ?? ""),
            String(c.name ?? ""),
          ]),
        };
      }
      const preview =
        r.text ??
        (r.identity
          ? JSON.stringify(r.identity, null, 2)
          : (r.rawBody ?? r.rawPreview ?? r.bodyPreview ?? ""));
      setResult({
        status: r.status,
        ok: r.ok,
        preview,
        meta: [
          r.semester ? `semester=${r.semester}` : null,
          r.classId ? `classId=${r.classId}` : null,
          r.projectType ? `projectType=${r.projectType}` : null,
          r.count != null ? `count=${r.count}` : null,
          r.loggedIn != null ? `loggedIn=${r.loggedIn}` : null,
          r.mutated ? "mutated+signed" : "replay-capture",
          r.byteLength != null ? `${r.byteLength} bytes` : null,
          r.parseError ? `parseError=${r.parseError}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        domainTable,
      });
      if (r.isError || r.ok === false) {
        onError(r.text ?? r.parseError ?? "Capability returned not ok");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTryError(msg);
      onError(msg);
    } finally {
      setTrying(false);
    }
  }

  return (
    <div className="tool-detail">
      <header className="tool-detail-header">
        <div className="tool-detail-title">
          <span className="chip chip-mcp">MCP</span>
          <h3>{cap.name}</h3>
          {cap.supportsMutation ? (
            <span className="chip chip-sem">mutable</span>
          ) : null}
        </div>
        {cap.title ? <p className="tool-detail-title-text">{cap.title}</p> : null}
        <p className="tool-detail-desc">{cap.description}</p>
        {cap.bind && typeof cap.bind === "object" && "primitive" in cap.bind ? (
          <p className="tool-detail-meta muted">
            bind → {(cap.bind as { primitive?: string }).primitive}
            {(cap.bind as { argMutations?: Record<string, boolean> }).argMutations
              ?.semester
              ? " · semester"
              : ""}
            {(cap.bind as { argMutations?: Record<string, boolean> }).argMutations
              ?.classId
              ? " · classId"
              : ""}
          </p>
        ) : null}
      </header>

      <section className="detail-section">
        <h4>Input</h4>
        <SchemaForm
          schema={cap.inputSchema}
          values={args}
          onChange={setArgs}
          disabled={trying || busy}
        />
      </section>

      <section className="detail-section detail-actions">
        <button
          type="button"
          className="primary"
          disabled={!hasAuth || trying || busy}
          onClick={() => void onTry()}
        >
          {trying ? "Trying…" : "Try"}
        </button>
        {!hasAuth ? <span className="hint">Đăng nhập trước khi Try.</span> : null}
      </section>

      {tryError ? <div className="try-error">{tryError}</div> : null}
      {result ? (
        <section className="detail-section try-result">
          <div className="try-result-bar">
            <span
              className={`status-code code-${Math.floor((result.status ?? 0) / 100)}xx`}
            >
              HTTP {result.status ?? "—"}
              {result.ok === false ? " · not ok" : result.ok ? " · ok" : ""}
            </span>
            <span className="hint">{result.meta}</span>
          </div>
          {result.domainTable ? (
            <div className="try-domain-table-wrap">
              <table className="try-domain-table">
                <thead>
                  <tr>
                    {result.domainTable.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.domainTable.rows.slice(0, 80).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <pre className="try-body">{result.preview.slice(0, 8000)}</pre>
        </section>
      ) : null}
    </div>
  );
}

function CatalogItem({
  row,
  active,
  checked,
  onSelect,
  onToggle,
}: {
  row: CatalogRow;
  active: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const canCheck = row.status === "candidate" || row.status === "proposed";
  return (
    <li className={active ? "catalog-item active" : "catalog-item"}>
      {canCheck ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${row.name}`}
        />
      ) : (
        <span className="check-spacer" />
      )}
      <button type="button" className="catalog-item-main" onClick={onSelect}>
        <div className="catalog-item-top">
          <span className={`method-badge method-${row.method.toLowerCase()}`}>
            {row.method}
          </span>
          <strong className="catalog-name">{row.name}</strong>
          <span className={`pipe-badge pipe-${row.status}`}>{row.status}</span>
        </div>
        <div className="catalog-item-meta">
          {row.isGwt ? <span className="chip chip-gwt">GWT</span> : null}
          {row.semester ? (
            <span className="chip chip-sem">{row.semester}</span>
          ) : null}
          {row.rpcMethod ? (
            <span className="rpc-hint">{row.rpcMethod}</span>
          ) : null}
          <span className="url-hint">{shortUrl(row.url)}</span>
        </div>
      </button>
    </li>
  );
}
