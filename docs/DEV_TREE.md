# Dev tree (core + sample packs + private packs)

Folder **cha** (không bắt buộc một git repo), ví dụ `~/dev/auto_mcp_ai/`:

```
<workspace>/
  auto_mcp_ai/                 # core (repo public)
  auto_mcp_ai_sample_packs/    # Jira sample
  auto_mcp_ai_packs/           # Entrade private packs
  pnpm-workspace.yaml          # xem docs/examples/dev-tree/
  package.json
```

## Yêu cầu

- **Node.js 22+** (`node:sqlite`)
- **pnpm 9+**
- Playwright Chromium (postinstall core hoặc `pnpm --filter @auto-mcp/browser-auth exec playwright install chromium`)

## Wire Entrade packs

```bash
cd <workspace>
pnpm install
pnpm wire:entrade   # hoặc: cd auto_mcp_ai_packs && pnpm wire:core
pnpm install
cd auto_mcp_ai && pnpm build:wired
```

`wire-entrade-core.mjs` ghi `packages/site-adapters/src/adapters.extra.ts` và copy skills.

**Không push** `adapters.extra.ts` đã populate lên remote public core:

```bash
cd auto_mcp_ai
git update-index --skip-worktree packages/site-adapters/src/adapters.extra.ts
```

## Chạy local

```bash
cd auto_mcp_ai
cp .env.example .env
pnpm dev
```

Dashboard: `AUTO_MCP_DASHBOARD_PORT` (mặc định 5173, `strictPort` — đổi port nếu bận).

## Backup dữ liệu explore

Site, candidates, capabilities: `auto_mcp_ai/.data/` (gitignored). Backup:

- `registry.db`, `vault.enc`, `profiles/`, `control-meta.json`
- Giữ **cùng** `AUTO_MCP_MASTER_KEY` khi restore `vault.enc`

Xem thêm [DATA_BACKUP.md](DATA_BACKUP.md).
