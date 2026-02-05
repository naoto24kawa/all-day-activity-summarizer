/**
 * SSE Server Main Process
 *
 * SSE サーバーを起動するメインプロセス
 * servers コマンドから子プロセスとして起動される
 */

import { setupFileLogger } from "@repo/core";
import consola from "consola";
import { loadConfig } from "../config.js";

// ファイルログを有効化
setupFileLogger("sse-server");

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const config = loadConfig();

  // 環境変数からポートを取得 (デフォルト値あり)
  const ssePort = process.env.SSE_SERVER_PORT
    ? Number.parseInt(process.env.SSE_SERVER_PORT, 10)
    : config.sseServer.port;

  // SSE サーバー起動
  consola.info(`Starting SSE server on http://localhost:${ssePort}`);
  const { createSSEServerApp } = await import("@repo/sse-server");
  const sseApp = createSSEServerApp();

  Bun.serve({
    fetch: sseApp.fetch,
    port: ssePort,
    idleTimeout: 0, // SSE 接続のためタイムアウト無効
  });

  consola.success(`SSE server running at http://localhost:${ssePort}`);

  // Graceful shutdown
  const shutdown = () => {
    consola.info("Shutting down SSE server...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process running
  await new Promise(() => {});
}

main().catch((error) => {
  consola.error("Failed to start SSE server:", error);
  process.exit(1);
});
