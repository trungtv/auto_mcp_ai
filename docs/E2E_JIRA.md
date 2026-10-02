# E2E smoke — Jira Cloud

Checklist ngắn cho demo public (Atlassian Cloud).

## Prerequisites

- `pnpm install`, Playwright Chromium, `.env` với vault key + control token
- `pnpm mcp:control:register` + reload MCP `auto_mcp_ai`

## Steps

1. **create_site** — `baseUrl`: instance Jira của bạn (tests dùng `https://example.atlassian.net`)
2. **login_start** / **login_confirm** — session trong vault
3. **browser_goto** — board hoặc issue list; **network_snapshot** sau thao tác UI
4. **approve_candidates** — approve primitives liên quan project search / issue / transitions
5. **list_capabilities** — thấy seed như `list_projects` hoặc pipeline `get_issue_with_transitions` khi đủ primitives
6. **try_capability** — một capability read-only
7. **register_site_mcp** — reload MCP key per-site trong Cursor

## Automated

```bash
pnpm typecheck
pnpm -r run test
pnpm smoke:mcp-control   # registry + create_site (Atlassian URL) without browser
```
