import { useEffect, useState } from "react";
import { api } from "./api";
import { SchemaForm, useSchemaArgs } from "./SchemaForm";
import {
  bodyPreview,
  redactHeaders,
  shortUrl,
  type CatalogRow,
} from "./toolDisplay";

type TryResult = {
  status: number;
  ok: boolean;
  bodyPreview: string;
  truncated: boolean;
  contentTypeHint: string;
  byteLength: number;
  captureContext?: Record<string, unknown>;
};

type Props = {
  siteId: string;
  row: CatalogRow | null;
  hasAuth: boolean;
  busy: boolean;
  onApproveCandidate: (candidateId: string) => void;
  onApproveProposed: (toolName: string) => void;
  onError: (message: string) => void;
};

export function ToolDetailPanel({
  siteId,
  row,
  hasAuth,
  busy,
  onApproveCandidate,
  onApproveProposed,
  onError,
}: Props) {
  const [args, setArgs] = useSchemaArgs(row?.key ?? "");
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);
  const [tryError, setTryError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [showOutputSchema, setShowOutputSchema] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setResult(null);
    setTryError(null);
    setShowRaw(false);
    setShowOutputSchema(false);
  }, [row?.key]);

  if (!row) {
    return (
      <div className="tool-detail empty-detail">
        <p className="empty">Chọn một tool hoặc candidate bên trái để xem chi tiết.</p>
      </div>
    );
  }

  const headers = redactHeaders(row.headers);
  const canTry = row.status === "approved" && hasAuth;

  async function onTry() {
    if (!row || row.status !== "approved") return;
    setTrying(true);
    setTryError(null);
    setResult(null);
    try {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined) clean[k] = v;
      }
      const r = await api.tryTool(siteId, row.name, clean);
      setResult(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTryError(msg);
      onError(msg);
    } finally {
      setTrying(false);
    }
  }

  async function copyPreview() {
    if (!result) return;
    await navigator.clipboard.writeText(result.bodyPreview);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const rawPayload = {
    name: row.name,
    title: row.title,
    status: row.status,
    method: row.method,
    url: row.url,
    description: row.description,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    annotations: row.annotations,
    captureContext: row.captureContext,
    argBindings: row.argBindings,
    headers: row.headers,
    bodyTemplate: row.bodyTemplate,
    rpcService: row.rpcService,
    rpcMethod: row.rpcMethod,
    semester: row.semester,
    classId: row.classId,
    frozen: row.frozen,
  };

  return (
    <div className="tool-detail">
      <header className="tool-detail-header">
        <div className="tool-detail-title">
          <span className={`method-badge method-${row.method.toLowerCase()}`}>
            {row.method}
          </span>
          <h3>{row.name}</h3>
          <span className={`pipe-badge pipe-${row.status}`}>{row.status}</span>
          {row.isGwt ? <span className="chip chip-gwt">GWT</span> : null}
          {row.frozen ? <span className="chip chip-frozen">frozen</span> : null}
          {row.semester ? (
            <span className="chip chip-sem">{row.semester}</span>
          ) : null}
          {row.classId ? (
            <span className="chip chip-sem">class {row.classId}</span>
          ) : null}
        </div>
        {row.title ? <p className="tool-detail-title-text">{row.title}</p> : null}
        <p className="tool-detail-desc">{row.description}</p>
        <p className="tool-detail-url" title={row.url}>
          <code>{shortUrl(row.url)}</code>
        </p>
      </header>

      {(row.captureContext && Object.keys(row.captureContext).length > 0) ||
      row.annotations ? (
        <section className="detail-section">
          <h4>Context & annotations</h4>
          <dl className="prov-grid">
            {row.captureContext?.rpcMethod ? (
              <>
                <dt>RPC</dt>
                <dd>
                  <code>
                    {row.captureContext.rpcService
                      ? `${row.captureContext.rpcService}.`
                      : ""}
                    {row.captureContext.rpcMethod}
                  </code>
                </dd>
              </>
            ) : null}
            {row.captureContext?.semester ? (
              <>
                <dt>Semester</dt>
                <dd>
                  <code>{row.captureContext.semester}</code>
                </dd>
              </>
            ) : null}
            {row.captureContext?.classId ? (
              <>
                <dt>Class id</dt>
                <dd>
                  <code>{row.captureContext.classId}</code>
                </dd>
              </>
            ) : null}
            {row.captureContext?.resourceHint ? (
              <>
                <dt>Resource</dt>
                <dd>
                  <code>{row.captureContext.resourceHint}</code>
                </dd>
              </>
            ) : null}
            {row.captureContext?.frozen !== undefined ? (
              <>
                <dt>Frozen</dt>
                <dd>{row.captureContext.frozen ? "yes" : "no"}</dd>
              </>
            ) : null}
            {row.annotations?.readOnlyHint !== undefined ? (
              <>
                <dt>readOnlyHint</dt>
                <dd>{String(row.annotations.readOnlyHint)}</dd>
              </>
            ) : null}
            {row.annotations?.openWorldHint !== undefined ? (
              <>
                <dt>openWorldHint</dt>
                <dd>{String(row.annotations.openWorldHint)}</dd>
              </>
            ) : null}
            {row.annotations?.destructiveHint !== undefined ? (
              <>
                <dt>destructiveHint</dt>
                <dd>{String(row.annotations.destructiveHint)}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="detail-section">
        <h4>Input schema</h4>
        <SchemaForm
          schema={row.inputSchema}
          values={args}
          onChange={setArgs}
          disabled={trying || busy}
        />
      </section>

      {row.outputSchema && Object.keys(row.outputSchema).length > 0 ? (
        <section className="detail-section">
          <button
            type="button"
            className="ghost raw-toggle"
            onClick={() => setShowOutputSchema((v) => !v)}
          >
            {showOutputSchema ? "Hide outputSchema" : "Show outputSchema"}
          </button>
          {showOutputSchema ? (
            <pre className="raw-json">{JSON.stringify(row.outputSchema, null, 2)}</pre>
          ) : null}
        </section>
      ) : null}

      <section className="detail-section">
        <h4>HTTP provenance</h4>
        <dl className="prov-grid">
          <dt>URL</dt>
          <dd>
            <code className="break">{row.url}</code>
          </dd>
          {row.rpcService ? (
            <>
              <dt>RPC service</dt>
              <dd>
                <code>{row.rpcService}</code>
              </dd>
            </>
          ) : null}
          {row.rpcMethod ? (
            <>
              <dt>RPC method</dt>
              <dd>
                <code>{row.rpcMethod}</code>
              </dd>
            </>
          ) : null}
          {Object.keys(row.argBindings).length > 0 ? (
            <>
              <dt>Arg bindings</dt>
              <dd>
                <ul className="binding-list">
                  {Object.entries(row.argBindings).map(([arg, b]) => (
                    <li key={arg}>
                      <code>{arg}</code> → {b.in}.{b.key}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>

        {headers.length > 0 ? (
          <div className="header-table-wrap">
            <table className="header-table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h) => (
                  <tr key={h.key} className={h.redacted ? "redacted" : undefined}>
                    <td>
                      <code>{h.key}</code>
                    </td>
                    <td>
                      <code>{h.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Không có headers capture.</p>
        )}

        {row.bodyTemplate !== undefined && row.bodyTemplate !== null ? (
          <div className="body-block">
            <div className="body-label">Body template</div>
            <pre>{bodyPreview(row.bodyTemplate)}</pre>
          </div>
        ) : null}
      </section>

      <section className="detail-section detail-actions">
        {row.status === "candidate" && row.candidateId ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onApproveCandidate(row.candidateId!)}
          >
            Approve this candidate
          </button>
        ) : null}
        {row.status === "proposed" ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onApproveProposed(row.name)}
          >
            Approve this tool
          </button>
        ) : null}
        {row.status === "approved" ? (
          <>
            <button
              type="button"
              className="primary"
              disabled={!canTry || trying || busy}
              title={!hasAuth ? "Cần đăng nhập (vault)" : "Replay với args form"}
              onClick={() => void onTry()}
            >
              {trying ? "Trying…" : "Try"}
            </button>
            {!hasAuth ? (
              <span className="hint">Đăng nhập trước khi Try.</span>
            ) : null}
          </>
        ) : null}
      </section>

      {tryError ? <div className="try-error">{tryError}</div> : null}
      {result ? (
        <section className="detail-section try-result">
          <div className="try-result-bar">
            <span className={`status-code code-${Math.floor(result.status / 100)}xx`}>
              HTTP {result.status}
              {result.ok === false ? " · not ok" : result.ok ? " · ok" : ""}
            </span>
            <span className="hint">
              {result.contentTypeHint} · {result.byteLength} bytes
              {result.truncated ? " · truncated" : ""}
            </span>
            <button type="button" className="ghost" onClick={() => void copyPreview()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="try-body">{result.bodyPreview}</pre>
        </section>
      ) : null}

      <section className="detail-section">
        <button
          type="button"
          className="ghost raw-toggle"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? "Hide raw JSON" : "Show raw JSON"}
        </button>
        {showRaw ? <pre className="raw-json">{JSON.stringify(rawPayload, null, 2)}</pre> : null}
      </section>
    </div>
  );
}
