/**
 * Worker Commands
 *
 * AI Worker と Local Worker を起動
 * workers コマンドは Launcher エンドポイント (再起動用) も提供
 */

import type { Subprocess } from "bun";
import type { Command } from "commander";
import consola from "consola";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig } from "../config.js";

interface WorkerProcess {
  name: string;
  proc: Subprocess | null;
  command: string[];
  env: Record<string, string>;
}

let workers: WorkerProcess[] = [];
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
 * Worker プロセスを起動
 */
function startWorker(worker: WorkerProcess): void {
  consola.info(`Starting ${worker.name}...`);

  worker.proc = Bun.spawn(worker.command, {
    env: { ...process.env, ...worker.env, FORCE_COLOR: "1" },
    stdout: "inherit",
    stderr: "inherit",
    onExit: (_proc, exitCode) => {
      if (!isRestarting) {
        consola.warn(`${worker.name} exited with code ${exitCode}`);
        // 自動再起動
        setTimeout(() => {
          if (!isRestarting) {
            consola.info(`Auto-restarting ${worker.name}...`);
            startWorker(worker);
          }
        }, 2000);
      }
    },
  });

  consola.success(`${worker.name} started (pid: ${worker.proc.pid})`);
}

/**
 * Worker プロセスを停止
 */
async function stopWorker(worker: WorkerProcess): Promise<void> {
  if (!worker.proc) return;

  try {
    worker.proc.kill("SIGTERM");
    const timeout = setTimeout(() => {
      consola.warn(`Force killing ${worker.name}...`);
      worker.proc?.kill("SIGKILL");
    }, 5000);

    await worker.proc.exited;
    clearTimeout(timeout);
    consola.info(`${worker.name} stopped`);
  } catch {
    // Already exited
  }
  worker.proc = null;
}

/**
 * 全 Worker を再起動
 */
async function restartAllWorkers(): Promise<{ gitPull: { success: boolean; output: string } }> {
  if (isRestarting) {
    return { gitPull: { success: false, output: "Already restarting" } };
  }

  isRestarting = true;
  consola.info("=== RESTART REQUESTED ===");

  // 全 Worker を停止
  await Promise.all(workers.map(stopWorker));

  // git pull を実行
  const gitResult = await gitPull();

  // 少し待機
  await Bun.sleep(1000);

  // 全 Worker を起動
  for (const worker of workers) {
    startWorker(worker);
  }

  isRestarting = false;
  return { gitPull: gitResult };
}

/**
 * 単一 Worker を再起動
 */
async function restartWorker(name: string): Promise<boolean> {
  const worker = workers.find((w) => w.name === name);
  if (!worker) return false;

  isRestarting = true;
  await stopWorker(worker);
  await Bun.sleep(500);
  startWorker(worker);
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
      type: "worker",
      processes: workers.map((w) => ({
        name: w.name,
        pid: w.proc?.pid ?? 0,
        running: w.proc !== null && !w.proc.killed,
      })),
      isRestarting,
    });
  });

  app.post("/restart", async (c) => {
    if (!validateToken(c.req.header("Authorization"), token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const result = await restartAllWorkers();
    return c.json({
      message: "Restart completed",
      gitPull: result.gitPull,
    });
  });

  app.post("/restart/:name", async (c) => {
    if (!validateToken(c.req.header("Authorization"), token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const name = c.req.param("name");
    const success = await restartWorker(name);

    if (success) {
      return c.json({ message: `${name} restarted` });
    }
    return c.json({ error: `Worker ${name} not found` }, 404);
  });

  return app;
}

export function registerWorkerCommand(program: Command): void {
  // ai-worker コマンド
  program
    .command("ai-worker")
    .description("Start the AI RPC worker server (Claude)")
    .option("-p, --port <port>", "AI Worker server port", "3100")
    .action(async (options: { port: string }) => {
      const port = Number.parseInt(options.port, 10);

      consola.info(`Starting AI Worker server on port ${port}...`);

      const workerProc = Bun.spawn(["bun", "run", "apps/ai-worker/src/index.ts"], {
        env: { ...process.env, AI_WORKER_PORT: String(port) },
        stdout: "inherit",
        stderr: "inherit",
      });

      consola.success(`AI Worker process started (pid: ${workerProc.pid})`);
      consola.info("Press Ctrl+C to stop");

      const shutdown = () => {
        consola.info("Shutting down AI Worker server...");
        workerProc.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await workerProc.exited;
    });

  // local-worker コマンド
  program
    .command("local-worker")
    .description("Start the Local RPC worker server (WhisperX + Kuromoji)")
    .option("-p, --port <port>", "Local Worker server port", "3200")
    .action(async (options: { port: string }) => {
      const port = Number.parseInt(options.port, 10);

      consola.info(`Starting Local Worker server on port ${port}...`);

      const workerProc = Bun.spawn(["bun", "run", "apps/local-worker/src/index.ts"], {
        env: { ...process.env, LOCAL_WORKER_PORT: String(port) },
        stdout: "inherit",
        stderr: "inherit",
      });

      consola.success(`Local Worker process started (pid: ${workerProc.pid})`);
      consola.info("Press Ctrl+C to stop");

      const shutdown = () => {
        consola.info("Shutting down Local Worker server...");
        workerProc.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await workerProc.exited;
    });

  // workers コマンド (両方同時起動 + Launcher)
  program
    .command("workers")
    .description("Start both AI Worker and Local Worker servers with launcher endpoint")
    .option("--ai-port <port>", "AI Worker server port", "3100")
    .option("--local-port <port>", "Local Worker server port", "3200")
    .option("--launcher-port <port>", "Launcher server port", "3998")
    .action(async (options: { aiPort: string; localPort: string; launcherPort: string }) => {
      const config = loadConfig();
      const aiPort = Number.parseInt(options.aiPort, 10);
      const localPort = Number.parseInt(options.localPort, 10);
      const launcherPort = options.launcherPort
        ? Number.parseInt(options.launcherPort, 10)
        : (config.workerLauncher?.port ?? 3998);
      const token = config.workerLauncher?.token ?? "";

      consola.info("========================================");
      consola.info("  ADAS Workers");
      consola.info("  (ai-worker + local-worker)");
      consola.info("========================================");
      consola.info("");

      // Worker 設定を初期化
      workers = [
        {
          name: "ai-worker",
          proc: null,
          command: ["bun", "run", "apps/ai-worker/src/index.ts"],
          env: { AI_WORKER_PORT: String(aiPort) },
        },
        {
          name: "local-worker",
          proc: null,
          command: ["bun", "run", "apps/local-worker/src/index.ts"],
          env: { LOCAL_WORKER_PORT: String(localPort) },
        },
      ];

      // Worker を起動
      for (const worker of workers) {
        startWorker(worker);
      }

      // Launcher サーバーを起動
      const launcherApp = createLauncherApp(token);
      Bun.serve({
        fetch: launcherApp.fetch,
        port: launcherPort,
        hostname: "0.0.0.0",
      });

      consola.success(`Launcher running on http://0.0.0.0:${launcherPort}`);
      consola.info("  POST /restart       - Restart all workers (git pull)");
      consola.info("  POST /restart/:name - Restart specific worker");
      consola.info("  GET  /status        - Get process status");
      consola.info("");
      consola.info("Press Ctrl+C to stop all workers");

      // Graceful shutdown
      const shutdown = async () => {
        consola.info("Shutting down workers...");
        isRestarting = true;
        await Promise.all(workers.map(stopWorker));
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Keep process running
      await new Promise(() => {});
    });

  // 互換性のため worker コマンドも残す (ai-worker のエイリアス)
  program
    .command("worker")
    .description("Start the AI RPC worker server (alias for ai-worker)")
    .option("-p, --port <port>", "Worker server port", "3100")
    .action(async (options: { port: string }) => {
      const port = Number.parseInt(options.port, 10);

      consola.warn("Note: 'worker' command is deprecated. Use 'ai-worker' instead.");
      consola.info(`Starting worker server on port ${port}...`);

      const workerProc = Bun.spawn(["bun", "run", "apps/ai-worker/src/index.ts"], {
        env: { ...process.env, AI_WORKER_PORT: String(port) },
        stdout: "inherit",
        stderr: "inherit",
      });

      consola.success(`Worker process started (pid: ${workerProc.pid})`);
      consola.info("Press Ctrl+C to stop");

      const shutdown = () => {
        consola.info("Shutting down worker server...");
        workerProc.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await workerProc.exited;
    });
}
