# Adding a site pack (1B-lite)

Core (`bound.ts`, `shared` format schema) stays stable. A site pack is a **separate package** (sibling git repo in the dev tree), registered via [`adapters.extra.ts`](adapters.extra.ts). The committed core ships **`extraAdapters = []`** — wire packs locally for development.

## Where the pack lives

| Kind | Location | Example |
|------|----------|---------|
| Public sample | Sibling repo, `packages/*` | [`auto_mcp_ai_sample_packs`](../../../../auto_mcp_ai_sample_packs) → `@auto-mcp/site-adapter-jira` |
| Custom / org | Your own repo | Same layout as sample packs |

Dev tree (folder **cha**, optional — not part of core git):

```
<workspace>/
  auto_mcp_ai/                 # core (repo này)
  auto_mcp_ai_sample_packs/    # public samples
  pnpm-workspace.yaml
```

## Pack layout

```
<packs-repo>/
  pnpm-workspace.yaml       # packages: ["packages/*"]
  package.json              # wire:core, build, test
  scripts/wire-*-core.mjs     # list adapters → adapters.extra on core
  packages/
    site-adapter-<name>/
      package.json
      tsconfig.json
      src/
        adapter.ts
        formatters.ts
        formatters.test.ts
        pipeline.integration.test.ts
        index.ts
```

Copy **`auto_mcp_ai_sample_packs`** when scaffolding a new public sample.

## Wire into core

1. Add packages to the **parent** `pnpm-workspace.yaml` (`auto_mcp_ai_sample_packs/packages/*` pattern).
2. Register the adapter in the pack repo wire script (`WIRED_SAMPLES` in `wire-sample-core.mjs`).
3. **`pnpm wire:sample`** (dev tree) or **`pnpm wire:core`** inside the sample packs repo.
4. **`pnpm install`** → **`pnpm run build:wired`** (or `pnpm build` from dev tree root).

Manual wiring (same as [`adapters.extra.example.ts`](adapters.extra.example.ts)):

```ts
import type { SiteAdapter } from "./types.js";
import { jiraAdapter } from "@auto-mcp/site-adapter-jira";

export const extraAdapters: SiteAdapter[] = [jiraAdapter];
```

**Do not push** populated `adapters.extra.ts` (or wire-patched `site-adapters/package.json`) to the **public** core remote.

## Imports from core (pack code)

```ts
import {
  findPrimitive,
  runPipeline,
  type SiteAdapter,
  type FormatContext,
} from "@auto-mcp/site-adapters";
```

Pack **`dependencies`**: `@auto-mcp/shared`, `@auto-mcp/site-adapters` (`workspace:*` in dev tree, or semver pin from npm).

## Steps

1. **Explore & approve** primitives via meta MCP.
2. **Scaffold** `packages/site-adapter-<name>/` in your packs repo.
3. **Wire** + **`pnpm install`** + **build** (see above).
4. **`upsert_capability`** with `bind.format` owned by your pack.
5. **Reload** the site MCP in Cursor.

Pack-author tools resolve sources under `../auto_mcp_ai_sample_packs/packages/site-adapter-<pack>/src` when not in core monorepo.

## Contract (`SiteAdapter`)

| Field | Required | Role |
|-------|----------|------|
| `id` / `match` | yes | Hostname routing |
| `capabilities` | yes | Seeds (may return `[]`) |
| `knownFormats` | for domain UX | Declares format ids |
| `applyArgs` | optional | Agent args → path/query/body |
| `formatCapability` | optional | HTTP body → agent markdown/structured |
| `mutateAndSign` | optional | Protocol mutation |

## Do not

- Add format switches in `bound.ts`
- Close a global format enum in `@auto-mcp/shared`
- Commit wired `adapters.extra.ts` on the public core remote
