import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, "../.."), "");
  const controlToken = env.AUTO_MCP_CONTROL_TOKEN ?? "";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@auto-mcp/shared": resolve(
          __dirname,
          "../../packages/shared/src/index.ts",
        ),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3847",
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (controlToken) {
                proxyReq.setHeader(
                  "Authorization",
                  `Bearer ${controlToken}`,
                );
              }
            });
          },
        },
      },
    },
  };
});
