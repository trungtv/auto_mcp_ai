import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertSecureEnv, getEnv } from "./env.js";

const env = getEnv();
assertSecureEnv(env);
const app = createApp();

serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
  console.log(`auto_mcp_ai control-plane listening on http://${info.address}:${info.port}`);
  console.log(`dataDir=${env.dataDir} (persistent; relative DATA_DIR is from repo root)`);
  if (env.allowInsecureDev) {
    console.warn("WARNING: AUTO_MCP_ALLOW_INSECURE_DEV is enabled — not for public exposure");
  } else {
    console.log("API auth: Authorization Bearer AUTO_MCP_CONTROL_TOKEN required");
  }
});
