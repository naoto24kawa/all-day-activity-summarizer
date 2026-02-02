import { serve } from "@hono/node-server";
import { setupFileLogger } from "@repo/core";
import { createDatabase } from "@repo/db";
import type { Command } from "commander";
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
import { startVocabularyExtractScheduler } from "../vocabulary/scheduler.js";

// ファイルログを有効化
setupFileLogger("serve");

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
 * 定期的に Worker の接続状態を確認する
 */
function startWorkerHealthCheck(config: AdasConfig, intervalMs = 30000): void {
  let wasAIConnected = false;
  let wasLocalConnected = false;

  const check = async () => {
    const isAIConnected = await checkAIWorkerConnection(config);
    if (isAIConnected && !wasAIConnected) {
      consola.success("AI Worker connection established");
    } else if (!isAIConnected && wasAIConnected) {
      consola.warn("AI Worker connection lost");
    }
    wasAIConnected = isAIConnected;

    const isLocalConnected = await checkLocalWorkerConnection(config);
    if (isLocalConnected && !wasLocalConnected) {
      consola.success("Local Worker connection established");
    } else if (!isLocalConnected && wasLocalConnected) {
      consola.warn("Local Worker connection lost");
    }
    wasLocalConnected = isLocalConnected;
  };

  // 定期チェック(初回は既に実行済みなのでスキップ)
  setInterval(check, intervalMs);
}

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the local API server")
    .option("-p, --port <port>", "Port number")
    .action(async (options: { port?: string }) => {
      const config = loadConfig();
      const port = options.port ? Number.parseInt(options.port, 10) : config.server.port;
      const db = createDatabase(config.dbPath);
      const app = createApp(db, { config });

      consola.info(`Starting API server on http://localhost:${port}`);

      serve({
        fetch: app.fetch,
        port,
      });

      consola.success(`API server running on http://localhost:${port}`);

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
    });
}
