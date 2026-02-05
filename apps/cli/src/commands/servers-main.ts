/**
 * Servers Main Process
 *
 * API サーバーと SSE サーバーを起動するメインプロセス
 * servers コマンドから子プロセスとして起動される
 */

import { setupFileLogger } from "@repo/core";
import { createDatabase } from "@repo/db";
import consola from "consola";
import { startAIJobScheduler } from "../ai-job/scheduler.js";
import { startClaudeCodeSystem } from "../claude-code/scheduler.js";
import type { AdasConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { startGitHubSystem } from "../github/scheduler.js";
import { startPromptImprovementScheduler } from "../prompt-improvement/scheduler.js";
import { createApp } from "../server/app.js";
import { startSlackSystem } from "../slack/scheduler.js";
import { startScheduler } from "../summarizer/scheduler.js";
import { initSSENotifier } from "../utils/sse-notifier.js";
import { startVocabularyExtractScheduler } from "../vocabulary/scheduler.js";

// ファイルログを有効化
setupFileLogger("servers");

/**
 * AI Worker への接続確認を行う
 */
async function checkAIWorkerConnection(config: AdasConfig): Promise<boolean> {
  const url = config.worker.url;
  try {
    const response = await fetch(`${url}/rpc/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      consola.success(`AI Worker connected: ${url}`);
      return true;
    }
    consola.warn(`AI Worker responded with status ${response.status}: ${url}`);
    return false;
  } catch (_error) {
    consola.warn(`AI Worker not available: ${url}`);
    return false;
  }
}

/**
 * Local Worker への接続確認を行う
 */
async function checkLocalWorkerConnection(config: AdasConfig): Promise<boolean> {
  const url = config.localWorker.url;
  try {
    const response = await fetch(`${url}/rpc/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      consola.success(`Local Worker connected: ${url}`);
      return true;
    }
    consola.warn(`Local Worker responded with status ${response.status}: ${url}`);
    return false;
  } catch (_error) {
    consola.warn(`Local Worker not available: ${url}`);
    return false;
  }
}

/**
 * 接続状態の変化をログ出力
 */
function logConnectionChange(name: string, isConnected: boolean, wasConnected: boolean): void {
  if (isConnected && !wasConnected) {
    consola.success(`${name} connection established`);
  } else if (!isConnected && wasConnected) {
    consola.warn(`${name} connection lost`);
  }
}

/**
 * 定期的に Worker の接続状態を確認する
 */
function startWorkerHealthCheck(config: AdasConfig, intervalMs = 30000): void {
  const state = { ai: false, local: false };

  const check = async () => {
    const isAI = await checkAIWorkerConnection(config);
    logConnectionChange("AI Worker", isAI, state.ai);
    state.ai = isAI;

    const isLocal = await checkLocalWorkerConnection(config);
    logConnectionChange("Local Worker", isLocal, state.local);
    state.local = isLocal;
  };

  // 定期チェック (初回は既に実行済みなのでスキップ)
  setInterval(check, intervalMs);
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const config = loadConfig();

  // 環境変数からポートを取得 (デフォルト値あり)
  const apiPort = process.env.SERVERS_API_PORT
    ? Number.parseInt(process.env.SERVERS_API_PORT, 10)
    : config.server.port;
  const ssePort = process.env.SERVERS_SSE_PORT
    ? Number.parseInt(process.env.SERVERS_SSE_PORT, 10)
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

  // API サーバー起動
  const db = createDatabase(config.dbPath);
  const apiApp = createApp(db, { config });

  consola.info(`Starting API server on http://localhost:${apiPort}`);

  Bun.serve({
    fetch: apiApp.fetch,
    port: apiPort,
    idleTimeout: 0, // SSE 接続のためタイムアウト無効
  });

  consola.success(`API server running on http://localhost:${apiPort}`);

  // SSE Notifier 初期化
  initSSENotifier(config);
  consola.success("SSE Notifier initialized");

  // Worker 接続確認
  await checkAIWorkerConnection(config);
  await checkLocalWorkerConnection(config);
  startWorkerHealthCheck(config);

  startScheduler(db, config);
  consola.success("Summary scheduler started");

  // Start Slack system if enabled
  const stopSlack = await startSlackSystem(db, config);
  if (stopSlack) {
    consola.success("Slack integration started");
  }

  // Start Claude Code system if enabled
  const stopClaudeCode = await startClaudeCodeSystem(db, config);
  if (stopClaudeCode) {
    consola.success("Claude Code integration started");
  }

  // Start GitHub system if enabled
  const stopGitHub = await startGitHubSystem(db, config);
  if (stopGitHub) {
    consola.success("GitHub integration started");
  }

  // Start Prompt Improvement scheduler
  startPromptImprovementScheduler(db);

  // Start Vocabulary Extract scheduler
  startVocabularyExtractScheduler(db);

  // Start AI Job scheduler
  startAIJobScheduler(db, config);

  consola.success("All servers and schedulers started");

  // Graceful shutdown
  const shutdown = () => {
    consola.info("Shutting down servers...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process running
  await new Promise(() => {});
}

main().catch((error) => {
  consola.error("Failed to start servers:", error);
  process.exit(1);
});
