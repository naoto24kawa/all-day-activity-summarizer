#!/usr/bin/env bun
/**
 * Dev Launcher
 *
 * 全プロセス (Servers, AI Worker, Local Worker, Frontend) を起動・管理
 * /restart エンドポイントで一括再起動が可能
 * リモートからのアクセスに対応 (トークン認証)
 *
 * Workers を別マシンで起動する場合:
 * ~/.adas/config.json で worker.remote: true, localWorker.remote: true を設定
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

interface LauncherConfig {
  port: number;
  token: string;
}

interface WorkerConfig {
  url: string;
  remote: boolean;
  token: string;
}

interface AdasConfig {
  worker?: WorkerConfig;
  localWorker?: WorkerConfig;
  launcher?: LauncherConfig;
}

interface ProcessConfig {
  name: string;
  command: string[];
  cwd?: string;
  skipIfRemote?: "worker" | "localWorker"; // remote: true の場合スキップ
}

const allProcesses: ProcessConfig[] = [
  {
    name: "servers",
    command: ["bun", "run", "apps/cli/src/index.ts", "servers"],
  },
  {
    name: "ai-worker",
    command: ["bun", "run", "apps/ai-worker/src/index.ts"],
    skipIfRemote: "worker",
  },
  {
    name: "local-worker",
    command: ["bun", "run", "apps/local-worker/src/index.ts"],
    skipIfRemote: "localWorker",
  },
  {
    name: "mcp-server",
    command: ["bun", "run", "apps/mcp-server/src/index.ts"],
  },
  {
    name: "frontend",
    command: ["bun", "run", "dev"],
    cwd: "apps/frontend",
  },
];

let runningProcesses: Map<string, Subprocess> = new Map();
let isRestarting = false;

/**
 * ~/.adas/config.json を読み込む
 */
function loadAdasConfig(): AdasConfig {
  const configPath = join(homedir(), ".adas", "config.json");

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as AdasConfig;
  } catch {
    return {};
  }
}

/**
 * ~/.adas/config.json から launcher 設定を読み込む
 */
function loadLauncherConfig(): LauncherConfig {
  const config = loadAdasConfig();
  return {
    port: config.launcher?.port ?? 3999,
    token: config.launcher?.token ?? "",
  };
}

/**
 * remote 設定に基づいて起動するプロセスをフィルタリング
 */
function getProcessesToLaunch(): ProcessConfig[] {
  const config = loadAdasConfig();
  const workerRemote = config.worker?.remote ?? false;
  const localWorkerRemote = config.localWorker?.remote ?? false;

  return allProcesses.filter((proc) => {
    if (proc.skipIfRemote === "worker" && workerRemote) {
      log(`Skipping ${proc.name} (remote mode)`);
      return false;
    }
    if (proc.skipIfRemote === "localWorker" && localWorkerRemote) {
      log(`Skipping ${proc.name} (remote mode)`);
      return false;
    }
    return true;
  });
}

function log(message: string): void {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] [launcher] ${message}`);
}

function startProcess(config: ProcessConfig): Subprocess {
  log(`Starting ${config.name}...`);

  const proc = Bun.spawn(config.command, {
    cwd: config.cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
    onExit: (_proc, exitCode, _signalCode, _error) => {
      if (!isRestarting) {
        log(`${config.name} exited with code ${exitCode}`);
      }
    },
  });

  return proc;
}

function startAllProcesses(): void {
  log("Starting all processes...");
  const processes = getProcessesToLaunch();
  for (const config of processes) {
    const proc = startProcess(config);
    runningProcesses.set(config.name, proc);
  }
  log("All processes started");
}

async function stopAllProcesses(): Promise<void> {
  log("Stopping all processes...");

  const killPromises = Array.from(runningProcesses.entries()).map(async ([name, proc]) => {
    try {
      proc.kill("SIGTERM");
      // 最大5秒待機
      const timeout = setTimeout(() => {
        log(`Force killing ${name}...`);
        proc.kill("SIGKILL");
      }, 5000);

      await proc.exited;
      clearTimeout(timeout);
      log(`${name} stopped`);
    } catch {
      // プロセスが既に終了している場合
    }
  });

  await Promise.all(killPromises);
  runningProcesses.clear();
  log("All processes stopped");
}

async function gitPull(): Promise<{ success: boolean; output: string }> {
  log("Running git pull...");

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
    log(`git pull: ${output || "Already up to date"}`);
  } else {
    log(`git pull failed: ${output}`);
  }

  return { success, output };
}

async function restart(): Promise<{ gitPull: { success: boolean; output: string } }> {
  if (isRestarting) {
    log("Already restarting, ignoring request");
    return { gitPull: { success: false, output: "Already restarting" } };
  }

  isRestarting = true;
  log("=== RESTART REQUESTED ===");

  await stopAllProcesses();

  // git pull を実行
  const gitResult = await gitPull();

  // 少し待機してポートが解放されるのを待つ
  await Bun.sleep(1000);

  startAllProcesses();
  isRestarting = false;

  return { gitPull: gitResult };
}

/**
 * トークン認証をチェック
 */
function validateToken(req: Request, expectedToken: string): boolean {
  // トークンが設定されていない場合は認証スキップ
  if (!expectedToken) {
    return true;
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  // Bearer <token> 形式
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }

  return match[1] === expectedToken;
}

function startRestartServer(config: LauncherConfig): void {
  const { port, token } = config;

  Bun.serve({
    hostname: "0.0.0.0", // 外部からのアクセスを許可
    port,
    fetch: async (req) => {
      const url = new URL(req.url);

      // CORS
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers });
      }

      // トークン認証 (restart エンドポイントのみ)
      if (url.pathname === "/restart") {
        if (!validateToken(req, token)) {
          log(`Unauthorized restart attempt from ${req.headers.get("x-forwarded-for") || "unknown"}`);
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...headers, "Content-Type": "application/json" },
          });
        }
      }

      if (url.pathname === "/restart" && req.method === "POST") {
        // 同期的に再起動を実行 (git pull の結果を返すため)
        const result = await restart();
        return new Response(
          JSON.stringify({
            message: "Restart completed",
            gitPull: result.gitPull,
          }),
          {
            headers: { ...headers, "Content-Type": "application/json" },
          },
        );
      }

      if (url.pathname === "/status") {
        const status = {
          processes: Array.from(runningProcesses.entries()).map(([name, proc]) => ({
            name,
            pid: proc.pid,
            running: !proc.killed,
          })),
          isRestarting,
        };
        return new Response(JSON.stringify(status), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404, headers });
    },
  });

  log(`Restart server listening on http://0.0.0.0:${port}`);
  log(`  POST /restart - Restart all processes${token ? " (token required)" : ""}`);
  log("  GET  /status  - Get process status");
  if (token) {
    log("  Authorization: Bearer <token>");
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  log("Received SIGINT, shutting down...");
  await stopAllProcesses();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  log("Received SIGTERM, shutting down...");
  await stopAllProcesses();
  process.exit(0);
});

// Main
const launcherConfig = loadLauncherConfig();

console.log("========================================");
console.log("  ADAS Dev Launcher");
console.log("========================================");
console.log("");

startRestartServer(launcherConfig);
startAllProcesses();

console.log("");
log("Ready! Press Ctrl+C to stop all processes");
