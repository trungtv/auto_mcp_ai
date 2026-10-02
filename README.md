# auto_mcp_ai

Local toolkit that explores a website, captures an authenticated browser session, proposes MCP tools from observed APIs, and runs those tools as MCP servers for Cursor.

**Site packs** live in sibling repos (not in this monorepo). Public samples: [`auto_mcp_ai_sample_packs`](docs/EXAMPLE_JIRA_PACK.md) (`packages/site-adapter-jira`, …). See [docs/EXAMPLE_JIRA_PACK.md](docs/EXAMPLE_JIRA_PACK.md) and `packages/site-adapters/src/ADD_SITE.md`.

## Requirements

- Node.js 22+ (uses built-in `node:sqlite`)
- pnpm 9+
- Chromium (installed via Playwright)

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
# Edit AUTO_MCP_MASTER_KEY and AUTO_MCP_CONTROL_TOKEN (and optionally CURSOR_API_KEY)
```

## Run

```bash
pnpm dev
```

- Dashboard: http://127.0.0.1:5173
- Control plane API: http://127.0.0.1:3847

## Usage — Meta MCP in Cursor (recommended)

1. `pnpm mcp:control:register` — adds `auto_mcp_ai` to `~/.cursor/mcp.json`
2. Reload MCP in Cursor
3. In Cursor chat: `create_site` → `login_start` → login in browser → `login_confirm`
4. Explore with `browser_*` / `network_snapshot`, then `approve_candidates` → `list_capabilities` → `register_site_mcp`
5. Reload the **per-site** MCP server — call **capabilities** (e.g. Jira `list_projects`), not raw approved XHR names

See [docs/META_MCP.md](docs/META_MCP.md) and [docs/E2E_JIRA.md](docs/E2E_JIRA.md). Site MCP exposes adapter capabilities; primitives are the captured HTTP layer underneath.

## Usage — Dashboard (optional)

1. `pnpm dev` → open http://127.0.0.1:5173 → **Add website**
2. **Đăng nhập** → confirm on dashboard
3. Chat explore / Quick scan → approve tools → **Register in Cursor**

## Auth model

- Manual browser login only — credentials are never stored
- Session cookies / captured auth headers live in an encrypted local vault
- Control-plane HTTP `/api/*` requires `Authorization: Bearer <AUTO_MCP_CONTROL_TOKEN>` (except `/api/health`)
- Bind `HOST=127.0.0.1` by default; non-loopback / weak master key / missing token are refused unless `AUTO_MCP_ALLOW_INSECURE_DEV=1`
- Tool replay is pinned to `site.baseUrl` origin (SSRF protection)
- On 401 / expired session, status becomes `expired` and you re-login the same way

## Packages

| Path | Role |
|------|------|
| `apps/dashboard` | Local web UI |
| `apps/control-plane` | Orchestration API |
| `packages/shared` | Types / Zod schemas |
| `packages/registry` | SQLite multi-server registry (`node:sqlite`) |
| `packages/vault` | Encrypted secrets |
| `packages/browser-auth` | Playwright login + capture |
| `packages/explorer` | Network → API candidates |
| `packages/mcp-generator` | Candidates → tool defs |
| `packages/mcp-runtime` | Per-site MCP stdio (replay tools) |
| `packages/mcp-control` | Meta MCP `auto_mcp_ai` for Cursor |
| `packages/cursor-discover` | Cursor SDK tool proposals + browser explore helpers |
| `packages/site-adapters` | Adapter registry, generic replay, `adapters.extra.ts` hook |

## Notes

- Intended for personal / research use with your own account
- Local data stays in `.data/` (gitignored)
- New sample site: add under `auto_mcp_ai_sample_packs/packages/` — see `packages/site-adapters/src/ADD_SITE.md`
- Do not commit wired `adapters.extra.ts` to this public remote
