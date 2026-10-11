# Meta MCP `auto_mcp_ai` (Cursor)

Gắn **một** MCP control-plane vào Cursor để quản lý site, login, explore, approve primitives, rồi đăng ký MCP per-site với **business capabilities**.

## Hai lớp quan trọng

| Lớp | Nghĩa | Ví dụ Jira |
|-----|--------|------------|
| **Primitive** | HTTP đã capture + approve | `get_2_project_search`, `jira_get_issue`, … |
| **Capability** | Tool agent gọi trên site MCP | `list_projects`, `get_issue_with_transitions`, … |

Site MCP `tools/list` = **capabilities** (seeds adapter + stored), **không** dump mọi primitive đã approve. Pack chuyên biệt (Jira) chưa unlock seed → list rỗng; `generic-replay` (host lạ) mới 1:1 primitive.

**Packs ≠ Servers:** adapter pack (code) không tạo site trong registry — vẫn cần `create_site` / Add website. Dữ liệu explore nằm trong `.data/` ([DATA_BACKUP.md](DATA_BACKUP.md)).

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
4. Explore SPA: `network_mark` → `browser_goto` / `browser_click` → `browser_wait` → `network_snapshot`. `quick_scan` (mặc định `reuseSession:true`). `set_explore_path` trước quick_scan nếu cần.
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
| Sites | `list_sites`, `get_site`, `create_site`, `set_active_site`, `set_explore_path` |
| Auth | `login_start`, `login_status`, `login_confirm`, `login_cancel` |
| Explore | `browser_*`, `network_*`, `list_candidates`, `note_focus`, `quick_scan` |
| Primitives | `approve_candidates`, `list_tools`, `upsert_tools` |
| Capabilities | `list_capabilities`, `upsert_capability`, `remove_capability`, `try_capability` |
| Runtime site pack | `list_installed_adapters`, `set_site_adapter_pack`, `bootstrap_site_pack`, `set_capability_publish_mode` |
| Publish | `register_site_mcp` |

## Runtime site pack (host lạ)

- **Truth:** `capabilities[]` trên registry + `adapterPackId` / `capabilityPublishMode`.
- **auto** (mặc định): `generic-replay` expose mọi primitive approved như MCP tool.
- **curated:** sau `bootstrap_site_pack` confirm — chỉ stored capabilities (format qua Format Engine trong core).

| Format | Mô tả |
|--------|--------|
| `generic.http` | Preview HTTP thô |
| `generic.json` | Parse JSON; `formatOptions.unwrap` (tối đa 8 segment) |
| `generic.jmespath` | `formatOptions.expression` (JMESPath, max 256 ký tự) |

Luồng V1.5: `test_endpoint_ir` confirm → `suggest_capability_format` (đọc IR) → `bootstrap_site_pack` / `upsert_capability` confirm.
- Domain pack (QLĐT, Jira): wire trong `adapters.extra.ts`; pin bằng `set_site_adapter_pack` nếu cần.
- Không sinh TypeScript pack per site trên runtime (non-goal).

## Ghi chú

- Login vẫn là manual (không lưu password).
- Meta MCP stdio đọc/ghi registry + vault trực tiếp; **không** cần `pnpm dev` đang chạy.
- Dashboard vẫn dùng được song song trên cùng `.data`.
- `upsert_capability` nên kèm `bind.format` (vd. `jira.issues`, `jira.issue`) để có output domain.
