# Meta MCP `auto_mcp_ai` (Cursor)

Gắn **một** MCP control-plane vào Cursor để quản lý site, login, explore, approve primitives, rồi đăng ký MCP per-site với **business capabilities**.

## Hai lớp quan trọng

| Lớp | Nghĩa | Ví dụ Jira |
|-----|--------|------------|
| **Primitive** | HTTP đã capture + approve | `get_2_project_search`, `jira_get_issue`, … |
| **Capability** | Tool agent gọi trên site MCP | `list_projects`, `get_issue_with_transitions`, … |

Site MCP `tools/list` = **capabilities** (seeds adapter + stored), **không** dump mọi primitive đã approve. Pack chuyên biệt (Jira) chưa unlock seed → list rỗng; `generic-replay` (host lạ) mới 1:1 primitive.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env   # AUTO_MCP_MASTER_KEY + AUTO_MCP_CONTROL_TOKEN
pnpm mcp:control:register
```

Reload MCP trong Cursor. Cùng `DATA_DIR` với dashboard/control-plane.

## Flow Jira (trong Cursor chat)

1. `create_site` — `baseUrl: https://your-domain.atlassian.net`, `explorePath: /` (hoặc board URL)
2. `login_start` — đăng nhập Atlassian trong Chromium headed
3. `login_confirm` — sau khi user nói đã login xong
4. Explore: `browser_goto` → thao tác UI → `network_snapshot` (hoặc `quick_scan`)
5. `list_candidates` — xem API đã bắt
6. `approve_candidates` — preview rồi `confirm:true` / `confirmAll:true`. Ưu tiên primitives unlock seed pipeline (vd. issue + transitions)
7. `list_capabilities` — xác nhận business tools sẽ lên site MCP
8. `try_capability` — smoke-test (cần vault auth)
9. `register_site_mcp` — ghi MCP per-site (`auto-mcp-<id8>`) vào `mcp.json`
10. Reload MCP server **per-site** trong Cursor

Chi tiết: [E2E_JIRA.md](E2E_JIRA.md). Thêm site pack: [EXAMPLE_JIRA_PACK.md](EXAMPLE_JIRA_PACK.md).

`set_active_site` được persist trong `.data/control-meta.json` (sống qua reload MCP).

## Tools

| Nhóm | Tools |
|------|--------|
| Sites | `list_sites`, `get_site`, `create_site`, `set_active_site` |
| Auth | `login_start`, `login_status`, `login_confirm`, `login_cancel` |
| Explore | `browser_*`, `network_*`, `list_candidates`, `note_focus`, `quick_scan` |
| Primitives | `approve_candidates`, `list_tools`, `upsert_tools` |
| Capabilities | `list_capabilities`, `upsert_capability`, `remove_capability`, `try_capability` |
| Publish | `register_site_mcp` |

## Ghi chú

- Login vẫn là manual (không lưu password).
- Meta MCP stdio đọc/ghi registry + vault trực tiếp; **không** cần `pnpm dev` đang chạy.
- Dashboard vẫn dùng được song song trên cùng `.data`.
- `upsert_capability` nên kèm `bind.format` (vd. `jira.issues`, `jira.issue`) để có output domain.
