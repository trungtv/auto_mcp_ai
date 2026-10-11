# Backup `.data/`

Explore, primitives, capabilities và session login nằm trong `DATA_DIR` (mặc định `auto_mcp_ai/.data/`).

| File / thư mục | Nội dung |
|----------------|----------|
| `registry.db` | Sites, candidates, tools, capabilities, chat |
| `vault.enc` | Cookies / auth (mã hóa bằng `AUTO_MCP_MASTER_KEY`) |
| `profiles/` | Playwright user data per site |
| `control-meta.json` | Active site cho meta MCP |

Restore: copy cả thư mục vào `DATA_DIR`, **không đổi** `AUTO_MCP_MASTER_KEY` nếu dùng vault cũ.

Packs trong git **không** thay thế backup này.
