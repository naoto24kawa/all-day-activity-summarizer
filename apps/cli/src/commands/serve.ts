import { serve } from "@hono/node-server";
import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { startClaudeCodeSystem } from "../claude-code/scheduler.js";
import type { AdasConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { createApp } from "../server/app.js";
import { startSlackSystem } from "../slack/scheduler.js";
import { startScheduler } from "../summarizer/scheduler.js";

/**
 * Worker への接続確認を行う
 */
async function checkWorkerConnection(config: AdasConfig): Promise<boolean> {
  const url = config.worker.url;
  try {
    const response = await fetch(`${url}/rpc/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      consola.success(`Worker connected: ${url}`);
      return true;
    }
    consola.warn(`Worker responded with status ${response.status}: ${url}`);
    return false;
  } catch (_error) {
    consola.warn(`Worker not available: ${url}`);
    return false;
  }
}

/**
 * 定期的に Worker の接続状態を確認する
 */
function startWorkerHealthCheck(config: AdasConfig, intervalMs = 30000): void {
  let wasConnected = false;

  const check = async () => {
    const isConnected = await checkWorkerConnection(config);
    if (isConnected && !wasConnected) {
      consola.success("Worker connection established");
    } else if (!isConnected && wasConnected) {
      consola.warn("Worker connection lost");
    }
    wasConnected = isConnected;
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
      await checkWorkerConnection(config);
      startWorkerHealthCheck(config);

      startScheduler(db);
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
    });
}
