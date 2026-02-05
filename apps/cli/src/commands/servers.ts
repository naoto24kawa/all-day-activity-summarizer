/**
 * Servers Command
 *
 * API サーバーと SSE サーバーを別々の子プロセスとして起動
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

let servers: ServerProcess[] = [];
let isRestarting = false;

/**
 * git checkout . を実行 (ローカル変更を破棄)
 */
async function gitCheckout(): Promise<{ success: boolean; output: string }> {
  consola.info("Running git checkout . ...");

  const proc = Bun.spawn(["git", "checkout", "."], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  const output = (stdout + stderr).trim();
  const success = exitCode === 0;

  if (success) {
    consola.success(`git checkout: ${output || "Done"}`);
  } else {
    consola.error(`git checkout failed: ${output}`);
  }

  return { success, output };
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
 * bun install を実行
 */
async function bunInstall(): Promise<{ success: boolean; output: string }> {
  consola.info("Running bun install...");

  const proc = Bun.spawn(["bun", "i"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  const output = (stdout + stderr).trim();
  const success = exitCode === 0;

  if (success) {
    consola.success(`bun install: ${output || "Done"}`);
  } else {
    consola.error(`bun install failed: ${output}`);
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
      if (!isRestarting) {
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

interface RestartResult {
  gitCheckout: { success: boolean; output: string };
  gitPull: { success: boolean; output: string };
  bunInstall: { success: boolean; output: string };
}

/**
 * 全 Server を再起動
 */
async function restartAllServers(): Promise<RestartResult> {
  const emptyResult = { success: false, output: "Already restarting" };
  if (isRestarting) {
    return { gitCheckout: emptyResult, gitPull: emptyResult, bunInstall: emptyResult };
  }

  isRestarting = true;
  consola.info("=== RESTART REQUESTED ===");

  // 全 Server を停止
  await Promise.all(servers.map(stopServer));

  // git checkout . を実行 (ローカル変更を破棄)
  const checkoutResult = await gitCheckout();

  // git pull を実行
  const pullResult = await gitPull();

  // bun install を実行
  const installResult = await bunInstall();

  // 少し待機
  await Bun.sleep(1000);

  // 全 Server を起動
  for (const server of servers) {
    startServer(server);
  }

  // プロセスが安定して起動したか確認
  await Bun.sleep(3000);

  const allRunning = servers.every((s) => s.proc && !s.proc.killed);
  if (allRunning) {
    consola.success("All servers restarted successfully");
  } else {
    consola.error("Some servers failed to restart - check logs");
  }

  isRestarting = false;
  return {
    gitCheckout: checkoutResult,
    gitPull: pullResult,
    bunInstall: installResult,
  };
}

/**
 * 単一 Server を再起動
 */
async function restartServer(name: string): Promise<boolean> {
  const server = servers.find((s) => s.name === name);
  if (!server) return false;

  isRestarting = true;
  await stopServer(server);
  await Bun.sleep(500);
  startServer(server);
  isRestarting = false;

  return true;
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
    return c.json({
      type: "server",
      processes: servers.map((s) => ({
        name: s.name,
        pid: s.proc?.pid ?? 0,
        running: s.proc !== null && !s.proc.killed,
      })),
      isRestarting,
    });
  });

  app.post("/restart", async (c) => {
    if (!validateToken(c.req.header("Authorization"), token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const result = await restartAllServers();
    return c.json({
      message: "Restart completed",
      gitCheckout: result.gitCheckout,
      gitPull: result.gitPull,
      bunInstall: result.bunInstall,
    });
  });

  app.post("/restart/:name", async (c) => {
    if (!validateToken(c.req.header("Authorization"), token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const name = c.req.param("name");
    const success = await restartServer(name);

    if (success) {
      return c.json({ message: `${name} restarted` });
    }
    return c.json({ error: `Server ${name} not found` }, 404);
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
      consola.info("  (API Server + SSE Server + Schedulers)");
      consola.info("========================================");
      consola.info("");

      // Server プロセス設定を初期化
      servers = [
        {
          name: "api-server",
          proc: null,
          command: ["bun", "run", "apps/cli/src/commands/api-server-main.ts"],
          env: { API_SERVER_PORT: String(apiPort) },
        },
        {
          name: "sse-server",
          proc: null,
          command: ["bun", "run", "apps/cli/src/commands/sse-server-main.ts"],
          env: { SSE_SERVER_PORT: String(ssePort) },
        },
      ];

      // Server を起動
      for (const server of servers) {
        startServer(server);
      }

      // Launcher サーバーを起動
      const launcherApp = createLauncherApp(token);
      Bun.serve({
        fetch: launcherApp.fetch,
        port: launcherPort,
      });

      consola.success(`Launcher running on http://localhost:${launcherPort}`);
      consola.info("  POST /restart       - Restart all servers (git pull)");
      consola.info("  POST /restart/:name - Restart specific server (api-server, sse-server)");
      consola.info("  GET  /status        - Get process status");
      consola.info("");
      consola.info("Press Ctrl+C to stop all servers");

      // Graceful shutdown
      const shutdown = async () => {
        consola.info("Shutting down...");
        isRestarting = true;
        await Promise.all(servers.map(stopServer));
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Keep process running
      await new Promise(() => {});
    });
}
