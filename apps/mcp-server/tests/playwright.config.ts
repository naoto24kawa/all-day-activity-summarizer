import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:43051" },
  webServer: {
    command: "bun run ../src/index.ts",
    url: "http://127.0.0.1:43051/health",
    env: { MCP_PORT: "43051", ADAS_API_URL: "http://127.0.0.1:43052" },
  },
});
