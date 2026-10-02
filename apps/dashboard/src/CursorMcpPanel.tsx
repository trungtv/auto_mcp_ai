import { useCallback, useEffect, useImperativeHandle, useState, forwardRef } from "react";
import { api } from "./api";

export type CursorMcpSnapshot = {
  path: string;
  exists: boolean;
  key: string;
  registered: boolean;
  servers: Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  >;
  siteEntry: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  } | null;
  document: {
    mcpServers: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    >;
  };
};

export type CursorMcpPanelHandle = {
  refresh: () => Promise<void>;
};

type Props = {
  siteId: string;
  disabled?: boolean;
};

export const CursorMcpPanel = forwardRef<CursorMcpPanelHandle, Props>(
  function CursorMcpPanel(props, ref) {
    const [data, setData] = useState<CursorMcpSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState<"json" | "key" | null>(null);

    const load = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.getCursorMcp(props.siteId);
        setData(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }, [props.siteId]);

    useImperativeHandle(ref, () => ({ refresh: load }), [load]);

    useEffect(() => {
      void load();
    }, [load]);

    async function copyText(kind: "json" | "key", text: string) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(kind);
        window.setTimeout(() => setCopied(null), 1500);
      } catch {
        setError("Không copy được vào clipboard");
      }
    }

    const jsonText = data
      ? JSON.stringify(data.document, null, 2)
      : "";

    return (
      <section className="cursor-mcp-panel">
        <div className="cursor-mcp-header">
          <div>
            <h3>Cursor mcp.json</h3>
            {data ? (
              <p className="cursor-mcp-path">
                <code title={data.path}>{data.path}</code>
                {!data.exists ? (
                  <span className="hint"> · file chưa tồn tại</span>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="cursor-mcp-actions">
            {data ? (
              <span
                className={`chip ${data.registered ? "chip-ok" : "chip-warn"}`}
              >
                {data.registered ? "registered" : "not in mcp.json"}
              </span>
            ) : null}
            <button
              type="button"
              disabled={props.disabled || loading}
              onClick={() => void load()}
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? <p className="error inline-error">{error}</p> : null}

        {data ? (
          <>
            <div className="cursor-mcp-site">
              <span className="meta-label">Site key</span>
              <div className="cursor-mcp-key-row">
                <code>{data.key}</code>
                <button
                  type="button"
                  className="ghost"
                  disabled={props.disabled}
                  onClick={() => void copyText("key", data.key)}
                >
                  {copied === "key" ? "Copied" : "Copy key"}
                </button>
              </div>
              {data.siteEntry ? (
                <pre className="cursor-mcp-entry">
                  {JSON.stringify(data.siteEntry, null, 2)}
                </pre>
              ) : (
                <p className="hint">
                  Chưa ghi — bấm <strong>Register in Cursor</strong> bên dưới.
                </p>
              )}
            </div>

            <div className="cursor-mcp-doc">
              <div className="cursor-mcp-doc-bar">
                <span className="meta-label">mcpServers (secrets redacted)</span>
                <button
                  type="button"
                  className="ghost"
                  disabled={props.disabled || !jsonText}
                  onClick={() => void copyText("json", jsonText)}
                >
                  {copied === "json" ? "Copied" : "Copy JSON"}
                </button>
              </div>
              <pre className="cursor-mcp-json">{jsonText || "{ \"mcpServers\": {} }"}</pre>
            </div>
          </>
        ) : loading ? (
          <p className="hint">Đang đọc mcp.json…</p>
        ) : null}
      </section>
    );
  },
);
