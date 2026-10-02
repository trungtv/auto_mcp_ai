# Sample packs — Jira (public repo)

Core **`auto_mcp_ai`** không ship site adapters trong monorepo. Demo public nằm repo sibling **`auto_mcp_ai_sample_packs`** (`packages/site-adapter-jira`, …).

## Clone

```bash
<workspace>/
  auto_mcp_ai/
  auto_mcp_ai_sample_packs/    # @auto-mcp/site-adapter-jira + future samples
```

```bash
git clone <auto_mcp_ai> auto_mcp_ai
git clone <auto_mcp_ai_sample_packs> auto_mcp_ai_sample_packs
```

## Wire

Từ folder cha (có `pnpm-workspace.yaml`):

```bash
pnpm install
pnpm wire:sample
pnpm install
pnpm run build:wired
```

Hoặc `cd auto_mcp_ai_sample_packs && pnpm wire:core`.

Thêm site mới: scaffold `packages/site-adapter-<name>/`, khai báo trong `scripts/wire-sample-core.mjs`, rồi wire lại.

## CI / clone core-only

`adapters.extra.ts` mặc định **rỗng** — `pnpm typecheck` + test core pass không cần sample packs.
