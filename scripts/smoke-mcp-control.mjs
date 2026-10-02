/**
 * Smoke: meta MCP register + list/create/set_active/upsert/register_site without browser.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerControlMcp } from "../packages/mcp-runtime/dist/index.js";
import {
  CONTROL_TOOLS,
  callControlTool,
  createControlContext,
} from "../packages/mcp-control/dist/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = mkdtempSync(join(tmpdir(), "auto-mcp-control-"));
const mcpPath = join(dataDir, "mcp.json");
const masterKey = "smoke-test-master-key-32chars!!";
process.env.CURSOR_MCP_PATH = mcpPath;

try {
  if (CONTROL_TOOLS.length < 20) {
    throw new Error(`expected many control tools, got ${CONTROL_TOOLS.length}`);
  }

  const controlEntry = resolve(root, "packages/mcp-control/dist/cli.js");
  const reg = registerControlMcp({
    controlEntry,
    dataDir,
    masterKey,
    mcpJsonPath: mcpPath,
  });
  const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
  if (!mcp.mcpServers?.auto_mcp_ai) throw new Error("missing auto_mcp_ai key");

  const ctx = createControlContext({ dataDir, masterKey });
  for (const [name, args] of [
    ["list_sites", {}],
    [
      "create_site",
      {
        baseUrl: "https://example.atlassian.net",
        explorePath: "/",
      },
    ],
  ]) {
    const r = await callControlTool(ctx, name, args);
    if (r.isError) throw new Error(`${name}: ${r.content[0]?.text}`);
  }

  const created = JSON.parse(
    (await callControlTool(ctx, "list_sites", {})).content[0].text,
  );
  const siteId = created.sites[0].id;

  let r = await callControlTool(ctx, "set_active_site", { siteId });
  if (r.isError) throw new Error(r.content[0]?.text);

  r = await callControlTool(ctx, "get_site", {});
  if (r.isError) throw new Error(r.content[0]?.text);

  r = await callControlTool(ctx, "upsert_tools", {
    tools: [
      {
        name: "get_smoke_ping",
        description: "smoke",
        method: "GET",
        url: "https://example.atlassian.net/",
        inputSchema: { type: "object", properties: {} },
        approved: true,
      },
    ],
  });
  if (r.isError) throw new Error(r.content[0]?.text);

  r = await callControlTool(ctx, "register_site_mcp", {});
  if (r.isError) throw new Error(r.content[0]?.text);
  const siteRegBody = JSON.parse(r.content[0].text);
  const mcp2 = JSON.parse(readFileSync(mcpPath, "utf8"));
  if (!mcp2.mcpServers?.[siteRegBody.key]) {
    throw new Error("per-site mcp entry missing from mcp.json");
  }
  if (!mcp2.mcpServers.auto_mcp_ai) throw new Error("meta entry wiped");

  console.log(
    JSON.stringify(
      {
        ok: true,
        metaKey: reg.key,
        siteId,
        siteMcpKey: siteRegBody.key,
        controlToolCount: CONTROL_TOOLS.length,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
