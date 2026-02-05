/**
 * Servers Command
 *
 * API サーバーと SSE サーバーを子プロセスとして起動
 * Launcher エンドポイント (再起動用) も提供
 */

import type { Subprocess } from "bun";
import type { Command } from "commander";
import consola from "consola";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig } from "../config.js";

interface ServerProcess {
  name: string;
  proc: Subprocess | null;
  command: string[];
  env: Record<string, string>;
}

let serverProcess: ServerProcess | null = null;
let isRestarting = false;

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
 * Server プロセスを起動
 */
function startServer(server: ServerProcess): void {
  consola.info(`Starting ${server.name}...`);

  server.proc = Bun.spawn(server.command, {
    env: { ...process.env, ...server.env, FORCE_COLOR: "1" },
    stdout: "inherit",
    stderr: "inherit",
    onExit: (_proc, exitCode) => {
      if (isRestarting) {
        // 再起動中の終了はログのみ
        if (exitCode !== 0) {
          consola.error(`${server.name} exited with code ${exitCode} during restart`);
        }
      } else {
        consola.warn(`${server.name} exited with code ${exitCode}`);
        // 自動再起動
        setTimeout(() => {
          if (!isRestarting) {
            consola.info(`Auto-restarting ${server.name}...`);
            startServer(server);
          }
        }, 2000);
      }
    },
  });

  consola.success(`${server.name} started (pid: ${server.proc.pid})`);
}

/**
 * Server プロセスを停止
 */
async function stopServer(server: ServerProcess): Promise<void> {
  if (!server.proc) return;

  try {
    server.proc.kill("SIGTERM");
    const timeout = setTimeout(() => {
      consola.warn(`Force killing ${server.name}...`);
      server.proc?.kill("SIGKILL");
    }, 5000);

    await server.proc.exited;
    clearTimeout(timeout);
    consola.info(`${server.name} stopped`);
  } catch {
    // Already exited
  }
  server.proc = null;
}

/**
 * Server を再起動
 */
async function restartServer(): Promise<{ gitPull: { success: boolean; output: string } }> {
  if (isRestarting) {
    return { gitPull: { success: false, output: "Already restarting" } };
  }

  if (!serverProcess) {
    return { gitPull: { success: false, output: "Server not initialized" } };
  }

  isRestarting = true;
  consola.info("=== RESTART REQUESTED ===");

  // Server を停止
  await stopServer(serverProcess);

  // git pull を実行
  const gitResult = await gitPull();

  // 少し待機
  await Bun.sleep(1000);

  // Server を起動
  consola.info("Restarting servers...");
  startServer(serverProcess);

  // プロセスが安定して起動したか確認
  await Bun.sleep(3000);

  if (serverProcess.proc && !serverProcess.proc.killed) {
    consola.success("Servers restarted successfully");
  } else {
    consola.error("Servers failed to restart - check logs");
  }

  isRestarting = false;
  return { gitPull: gitResult };
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
function createLauncherApp(token: string): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/status", (c) => {
    const isRunning = serverProcess?.proc !== null && !serverProcess?.proc?.killed;
    const pid = serverProcess?.proc?.pid ?? 0;

    return c.json({
      type: "server",
      processes: serverProcess
        ? [
            {
              name: "API Server",
              pid,
              running: isRunning,
            },
            {
              name: "SSE Server",
              pid,
              running: isRunning,
            },
          ]
        : [],
      isRestarting,
    });
  });

  app.post("/restart", async (c) => {
    if (!validateToken(c.req.header("Authorization"), token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const result = await restartServer();
    return c.json({
      message: "Restart completed",
      gitPull: result.gitPull,
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
      const token = config.launcher?.token ?? "";

      consola.info("========================================");
      consola.info("  ADAS Servers");
      consola.info("  (API + SSE + Schedulers)");
      consola.info("========================================");
      consola.info("");

      // Server プロセス設定を初期化
      serverProcess = {
        name: "servers-main",
        proc: null,
        command: ["bun", "run", "apps/cli/src/commands/servers-main.ts"],
        env: {
          SERVERS_API_PORT: String(apiPort),
          SERVERS_SSE_PORT: String(ssePort),
        },
      };

      // Server を起動
      startServer(serverProcess);

      // Launcher サーバーを起動
      const launcherApp = createLauncherApp(token);
      Bun.serve({
        fetch: launcherApp.fetch,
        port: launcherPort,
      });

      consola.success(`Launcher running on http://localhost:${launcherPort}`);
      consola.info("  POST /restart - Restart servers (git pull + restart)");
      consola.info("  GET  /status  - Get process status");
      consola.info("");
      consola.info("Press Ctrl+C to stop servers");

      // Graceful shutdown
      const shutdown = async () => {
        consola.info("Shutting down...");
        isRestarting = true;
        if (serverProcess) {
          await stopServer(serverProcess);
        }
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Keep process running
      await new Promise(() => {});
    });
}
