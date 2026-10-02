import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  streamChat,
  type ChatMessage,
  type ChatSseEvent,
  type McpSite,
} from "./api";

const SUGGESTIONS = [
  "Đối chiếu coverage: candidates vs primitives vs capabilities đã có — còn thiếu gì?",
  "Approve các API Jira search/board hữu ích (bỏ avatar), rồi bind capability tương ứng.",
  "Try capability search_issues (hoặc list_board_issues), rồi register_site_mcp.",
  "Đọc pack jira hiện tại và đề xuất chỉnh formatter (chưa ghi file).",
];

type ActivityStep =
  | { id: string; kind: "status"; text: string }
  | { id: string; kind: "thinking"; text: string; open: boolean }
  | {
      id: string;
      kind: "tool";
      callId: string;
      name: string;
      status: "started" | "completed" | "error";
      argsSummary?: string;
      resultSummary?: string;
      open: boolean;
    };

function toolStatusOf(
  s?: string,
): "started" | "completed" | "error" {
  if (s === "error" || s === "started" || s === "completed") return s;
  return "completed";
}

function activityFromMessage(m: ChatMessage): ActivityStep[] {
  if (!m.activity?.length) return [];
  return m.activity.map((step, i) => {
    const id = `${m.id}-act-${i}`;
    if (step.kind === "status") {
      return { id, kind: "status" as const, text: step.text ?? "" };
    }
    if (step.kind === "thinking") {
      return { id, kind: "thinking" as const, text: step.text ?? "", open: false };
    }
    return {
      id,
      kind: "tool" as const,
      callId: step.callId ?? id,
      name: step.toolName ?? "tool",
      status: toolStatusOf(step.toolStatus),
      argsSummary: step.argsSummary,
      resultSummary: step.resultSummary,
      open: false,
    };
  });
}

function applySseToActivity(
  prev: ActivityStep[],
  ev: Extract<ChatSseEvent, { type: "status" | "thinking" | "tool" }>,
): ActivityStep[] {
  if (ev.type === "status") {
    return [
      ...prev,
      { id: `status-${Date.now()}-${prev.length}`, kind: "status", text: ev.message },
    ];
  }
  if (ev.type === "thinking") {
    const last = prev[prev.length - 1];
    if (last?.kind === "thinking") {
      return prev.map((s, i) =>
        i === prev.length - 1 ? { ...last, text: ev.text } : s,
      );
    }
    return [
      ...prev,
      {
        id: `thinking-${Date.now()}`,
        kind: "thinking",
        text: ev.text,
        open: false,
      },
    ];
  }
  const idx = prev.findIndex((s) => s.kind === "tool" && s.callId === ev.callId);
  if (idx >= 0) {
    return prev.map((s, i) => {
      if (i !== idx || s.kind !== "tool") return s;
      return {
        ...s,
        name: ev.name,
        status: ev.status,
        argsSummary: ev.argsSummary ?? s.argsSummary,
        resultSummary: ev.resultSummary ?? s.resultSummary,
      };
    });
  }
  return [
    ...prev,
    {
      id: `tool-${ev.callId}`,
      kind: "tool",
      callId: ev.callId,
      name: ev.name,
      status: ev.status,
      argsSummary: ev.argsSummary,
      resultSummary: ev.resultSummary,
      open: false,
    },
  ];
}

function ActivityLog(props: {
  steps: ActivityStep[];
  onToggle: (id: string) => void;
}) {
  if (props.steps.length === 0) return null;
  return (
    <div className="activity-log">
      {props.steps.map((step) => {
        if (step.kind === "status") {
          return (
            <div key={step.id} className="activity-step activity-status">
              {step.text}
            </div>
          );
        }
        if (step.kind === "thinking") {
          return (
            <div key={step.id} className="activity-step activity-thinking">
              <button
                type="button"
                className="activity-toggle"
                onClick={() => props.onToggle(step.id)}
              >
                <span className="activity-chevron">{step.open ? "▼" : "▶"}</span>
                Thinking
              </button>
              {step.open && (
                <pre className="activity-body">{step.text || "(empty)"}</pre>
              )}
            </div>
          );
        }
        return (
          <div key={step.id} className="activity-step activity-tool">
            <button
              type="button"
              className="activity-toggle"
              onClick={() => props.onToggle(step.id)}
            >
              <span className="activity-chevron">{step.open ? "▼" : "▶"}</span>
              {step.name} · {step.status}
            </button>
            {step.open && (
              <div className="activity-body">
                {step.argsSummary && (
                  <>
                    <div className="activity-label">args</div>
                    <pre>{step.argsSummary}</pre>
                  </>
                )}
                {step.resultSummary && (
                  <>
                    <div className="activity-label">result</div>
                    <pre>{step.resultSummary}</pre>
                  </>
                )}
                {!step.argsSummary && !step.resultSummary && (
                  <pre>(no payload)</pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ChatPanel(props: {
  site: McpSite;
  cursorSdk: boolean;
  hasAuth: boolean;
  disabled?: boolean;
  onSiteUpdate: (site: McpSite) => void;
  onError: (msg: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(props.site.chatMessages ?? []);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [liveActivity, setLiveActivity] = useState<ActivityStep[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(props.site.chatMessages ?? []);
  }, [props.site.id, props.site.chatMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, liveActivity, localError, openIds]);

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLiveActivity((prev) =>
      prev.map((s) =>
        s.id === id && (s.kind === "thinking" || s.kind === "tool")
          ? { ...s, open: !s.open }
          : s,
      ),
    );
  }

  function withOpenState(steps: ActivityStep[]): ActivityStep[] {
    return steps.map((s) =>
      s.kind === "thinking" || s.kind === "tool"
        ? { ...s, open: openIds.has(s.id) || s.open }
        : s,
    );
  }

  async function reloadChat() {
    const chat = await api.getChat(props.site.id);
    setMessages(chat.messages);
  }

  async function send(text: string) {
    if (!text.trim() || sending) return;
    if (!props.hasAuth) {
      const msg = "Đăng nhập trước khi chat explore.";
      setLocalError(msg);
      props.onError(msg);
      return;
    }

    setSending(true);
    setStreaming("");
    setLiveActivity([]);
    setLocalError(null);
    setDraft("");
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      let acc = "";
      await streamChat(props.site.id, text, (ev) => {
        if (ev.type === "status" || ev.type === "thinking" || ev.type === "tool") {
          setLiveActivity((prev) => applySseToActivity(prev, ev));
        } else if (ev.type === "token") {
          acc += ev.text;
          setStreaming(acc);
        } else if (ev.type === "done" && ev.site) {
          props.onSiteUpdate(ev.site);
        } else if (ev.type === "error") {
          setLocalError(ev.message);
          props.onError(ev.message);
        }
      });
      await reloadChat();
      setStreaming("");
      setLiveActivity([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
      props.onError(msg);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  return (
    <section className="section chat-panel">
      <h3>Chat explore agent</h3>
      <p className="chat-hint">
        Sau capture: list IR → đề xuất tên → confirm compile / upsert / register.
        Không invent endpoint. Sau register, tab Overview có <code>mcp.json</code> + IR.
      </p>

      {!props.cursorSdk && (
        <div className="chat-warn">
          Chưa thấy <code>CURSOR_API_KEY</code> trong <code>.env</code>. Thêm key từ{" "}
          <a href="https://cursor.com/dashboard/integrations" target="_blank" rel="noreferrer">
            Cursor Dashboard → Integrations
          </a>
          , rồi restart <code>pnpm dev</code>. Không có key thì chat thường sẽ lỗi auth.
        </div>
      )}

      {!props.hasAuth && (
        <div className="chat-warn">Cần đăng nhập site trước khi chat explore.</div>
      )}

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="suggestion"
            disabled={sending || props.disabled || !props.hasAuth}
            onClick={() => void send(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="chat-log">
        {messages.length === 0 && !streaming && !sending && liveActivity.length === 0 && (
          <p className="empty">Chưa có hội thoại. Chọn gợi ý hoặc nhập hướng explore.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="chat-turn">
            {m.role === "assistant" && m.activity && m.activity.length > 0 && (
              <ActivityLog
                steps={withOpenState(activityFromMessage(m))}
                onToggle={toggleOpen}
              />
            )}
            <div className={`chat-bubble ${m.role}`}>
              <div className="chat-role">{m.role}</div>
              <div className="chat-content">{m.content}</div>
            </div>
          </div>
        ))}
        {(sending || (!streaming && liveActivity.length > 0)) &&
          liveActivity.length > 0 && (
            <ActivityLog steps={liveActivity} onToggle={toggleOpen} />
          )}
        {streaming && (
          <div className="chat-bubble assistant streaming">
            <div className="chat-role">assistant</div>
            <div className="chat-content">{streaming}</div>
          </div>
        )}
        {localError && <div className="chat-error">{localError}</div>}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="VD: mở danh sách SV và bắt API search…"
          disabled={sending || props.disabled}
        />
        <button
          className="primary"
          type="submit"
          disabled={sending || props.disabled || !draft.trim() || !props.hasAuth}
        >
          {sending ? "Đang explore…" : "Gửi"}
        </button>
      </form>
    </section>
  );
}
