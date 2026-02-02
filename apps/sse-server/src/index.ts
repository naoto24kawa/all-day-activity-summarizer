/**
 * SSE Server Entry Point
 */

import { setupFileLogger } from "@repo/core";
import consola from "consola";
import { createSSEServerApp } from "./app.js";

setupFileLogger("sse-server");

const PORT = Number(process.env.SSE_SERVER_PORT ?? "3002");

const app = createSSEServerApp();

consola.info(`SSE server starting on port ${PORT}...`);

Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

consola.success(`SSE server running at http://localhost:${PORT}`);
consola.info("  - SSE endpoint: GET /sse");
consola.info("  - RPC endpoint: POST /rpc/emit");
consola.info("  - Health check: GET /rpc/health");
