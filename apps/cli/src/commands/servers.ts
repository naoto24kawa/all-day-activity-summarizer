/**
 * Servers Command
 *
 * API サーバーと SSE サーバーを同時に起動
 * Launcher エンドポイント (再起動用) も提供
 */

import { setupFileLogger } from "@repo/core";
import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { Hono } from "hono";
import { cors } from "hono/cors";
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
 * git pull を実行
 */
async function gitPull(): Promise<{ success: boolean; output: string }> {
  consola.info("Running git pull...");

  const proc = Bun.spawn(["git", "pull"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  const output = (stdout + stderr).trim();
  const success = exitCode === 0;

  if (success) {
    consola.success(`git pull: ${output || "Already up to date"}`);
  } else {
    consola.error(`git pull failed: ${output}`);
  }

  return { success, output };
}

/**
 * トークン認証
 */
function validateToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!expectedToken) return true;
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] === expectedToken;
}

/**
 * Launcher エンドポイントを作成
 */
function createLauncherApp(config: AdasConfig): Hono {
  const app = new Hono();
  const token = config.launcher?.token ?? "";

  app.use("*", cors());

  app.get("/status", (c) => {
    return c.json({
      type: "server",
      processes: [{ name: "servers", pid: process.pid, running: true }],
      isRestarting: false,
    });
  });

  app.post("/restart", async (c) => {
    if (!validateToken(c.req.header("Authorization"), token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    consola.info("=== RESTART REQUESTED ===");

    // git pull を実行
    const gitResult = await gitPull();

    // レスポンスを返してからプロセスを終了
    setTimeout(() => {
      consola.info("Restarting servers...");
      process.exit(0); // 外部の launcher/systemd が再起動
    }, 100);

    return c.json({
      message: "Restarting...",
      gitPull: gitResult,
    });
  });

  return app;
}

export function registerServersCommand(program: Command): void {
  program
    .command("servers")
    .description("Start both API server and SSE server with launcher endpoint")
    .option("--api-port <port>", "API server port number")
    .option("--sse-port <port>", "SSE server port number")
    .option("--launcher-port <port>", "Launcher server port number")
    .action(async (options: { apiPort?: string; ssePort?: string; launcherPort?: string }) => {
      const config = loadConfig();
      const apiPort = options.apiPort ? Number.parseInt(options.apiPort, 10) : config.server.port;
      const ssePort = options.ssePort
        ? Number.parseInt(options.ssePort, 10)
        : config.sseServer.port;
      const launcherPort = options.launcherPort
        ? Number.parseInt(options.launcherPort, 10)
        : (config.launcher?.port ?? 3999);

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

      // Start Launcher server
      const launcherApp = createLauncherApp(config);
      Bun.serve({
        fetch: launcherApp.fetch,
        port: launcherPort,
      });
      consola.success(`Launcher running on http://localhost:${launcherPort}`);
      consola.info("  POST /restart - Restart servers (git pull + exit)");
      consola.info("  GET  /status  - Get process status");
    });
}
