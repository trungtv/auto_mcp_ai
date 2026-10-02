# Chat explore (dashboard + Cursor SDK)

Dashboard **Chat** dùng Cursor agent SDK với browser/network tools (cùng hướng meta MCP).

## Quick start (Jira demo)

1. `pnpm dev` → mở site trong dashboard
2. Add site `https://your-domain.atlassian.net` nếu chưa có
3. Login → explore trong chat → approve → register MCP

Pack-author tools sửa source trong repo sample packs (`auto_mcp_ai_sample_packs/packages/site-adapter-<pack>/src/`). Pack mới: scaffold repo packs + wire `adapters.extra.ts` — xem `packages/site-adapters/src/ADD_SITE.md`.
