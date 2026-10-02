import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { upgradeTools } from "@auto-mcp/mcp-generator";
import { Registry } from "@auto-mcp/registry";
import {
  getCapability,
  listCapabilitiesForSite,
  resolveAdapter,
  type AdapterContext,
} from "@auto-mcp/site-adapters";
import type { ToolDef } from "@auto-mcp/shared";
import { Vault } from "@auto-mcp/vault";
import { AuthExpiredError } from "./replay.js";
import { createSiteReplay } from "./site-replay.js";

export interface RuntimeOptions {
  siteId: string;
  dataDir: string;
  masterKey: string;
}

function toolsNeedUpgrade(tools: ToolDef[]): boolean {
  return tools.some(
    (t) =>
      !t.title ||
      !t.outputSchema ||
      Object.keys(t.outputSchema).length === 0 ||
      t.captureContext === undefined ||
      !t.annotations,
  );
}

/** Backfill ToolDef schemas once into registry if older tools lack new fields. */
function ensureUpgradedTools(registry: Registry, siteId: string): ToolDef[] {
  const current = registry.get(siteId);
  if (!current) return [];
  if (!toolsNeedUpgrade(current.tools) && !toolsNeedUpgrade(current.proposedTools)) {
    return current.tools.filter((t) => t.approved);
  }
  const tools = upgradeTools(current.tools);
  const proposedTools = upgradeTools(current.proposedTools);
  registry.update(siteId, { tools, proposedTools });
  return tools.filter((t) => t.approved);
}

export async function startMcpServer(options: RuntimeOptions): Promise<void> {
  const registry = new Registry(options.dataDir);
  const vault = new Vault(options.dataDir, options.masterKey);

  const site = registry.get(options.siteId);
  if (!site) {
    throw new Error(`Unknown site id: ${options.siteId}`);
  }

  ensureUpgradedTools(registry, options.siteId);

  const server = new Server(
    { name: site.cursorMcpKey, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const current = registry.get(options.siteId);
    if (!current) return { tools: [] };
    const primitives = ensureUpgradedTools(registry, options.siteId);
    const adapter = resolveAdapter(current);
    const caps = listCapabilitiesForSite({
      site: current,
      primitives,
    });
    return {
      tools: caps.map((c) => ({
        name: c.name,
        title: c.title,
        description: c.description,
        inputSchema: c.inputSchema,
        ...(c.outputSchema ? { outputSchema: c.outputSchema } : {}),
        ...(c.annotations ? { annotations: c.annotations } : {}),
        // surface adapter id for clients that care
        _meta: { adapterId: adapter.id, supportsMutation: c.supportsMutation },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const current = registry.get(options.siteId);
    if (!current) {
      return {
        content: [{ type: "text", text: "Site not found in registry" }],
        isError: true,
      };
    }

    const auth = vault.get(options.siteId);
    if (!auth) {
      registry.update(options.siteId, { status: "needs_auth" });
      return {
        content: [
          {
            type: "text",
            text: "No auth snapshot. On meta MCP auto_mcp_ai call login_start → log in → login_confirm (same DATA_DIR). Dashboard Đăng nhập also works.",
          },
        ],
        isError: true,
      };
    }

    const primitives = ensureUpgradedTools(registry, options.siteId);
    const cap = getCapability(
      { site: current, primitives },
      request.params.name,
    );
    if (!cap) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown capability: ${request.params.name}. Reload tools/list (business capabilities via site adapter — not raw primitives).`,
          },
        ],
        isError: true,
      };
    }

    const ctx: AdapterContext = {
      site: current,
      auth,
      primitives,
      replay: createSiteReplay({
        site: current,
        onAuth: (snap) => vault.set(options.siteId, snap),
      }),
    };

    try {
      return await cap.execute(
        ctx,
        (request.params.arguments ?? {}) as Record<string, unknown>,
      );
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        registry.update(options.siteId, { status: "expired" });
        return {
          content: [
            {
              type: "text",
              text: `${err.message}. Re-authenticate via meta MCP auto_mcp_ai: login_start → login_confirm (or dashboard Đăng nhập lại).`,
            },
          ],
          isError: true,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
