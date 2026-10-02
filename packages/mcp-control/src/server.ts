import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createControlContext } from "./context.js";
import { callControlTool, CONTROL_TOOLS } from "./tools.js";
import { CONTROL_MCP_INSTRUCTIONS } from "./workflow.js";

export interface ControlServerOptions {
  dataDir: string;
  masterKey: string;
}

export async function startControlMcpServer(
  options: ControlServerOptions,
): Promise<void> {
  const ctx = createControlContext(options);

  const server = new Server(
    { name: "auto_mcp_ai", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: CONTROL_MCP_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CONTROL_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
      ...(t.annotations ? { annotations: t.annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return callControlTool(
      ctx,
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
