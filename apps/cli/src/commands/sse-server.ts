/**
 * SSE Server Command
 *
 * 統一 SSE サーバーを起動
 */

import { setupFileLogger } from "@repo/core";
import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";

// ファイルログを有効化
setupFileLogger("sse-server");

export function registerSSEServerCommand(program: Command): void {
  program
    .command("sse-server")
    .description("Start the SSE server for real-time event broadcasting")
    .option("-p, --port <port>", "Port number")
    .action(async (options: { port?: string }) => {
      const config = loadConfig();
      const port = options.port ? Number.parseInt(options.port, 10) : config.sseServer.port;

      consola.info(`Starting SSE server on http://localhost:${port}`);

      // SSE サーバーアプリを動的インポート
      const { createSSEServerApp } = await import("@repo/sse-server");
      const app = createSSEServerApp();

      Bun.serve({
        fetch: app.fetch,
        port,
      });

      consola.success(`SSE server running at http://localhost:${port}`);
      consola.info("  - SSE endpoint: GET /sse");
      consola.info("  - RPC endpoint: POST /rpc/emit");
      consola.info("  - Health check: GET /rpc/health");
    });
}
