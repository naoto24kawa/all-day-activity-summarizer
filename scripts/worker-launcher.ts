#!/usr/bin/env bun
/**
 * Worker Launcher
 *
 * Worker マシン用: ai-worker と local-worker を管理
 * メインマシンの UI から操作可能
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

interface LauncherConfig {
  port: number;
  token: string;
  aiWorkerEnabled: boolean;
  localWorkerEnabled: boolean;
  aiWorkerPort: number;
  localWorkerPort: number;
}

interface ProcessConfig {
  name: string;
  command: string[];
  env?: Record<string, string>;
}

let runningProcesses: Map<string, Subprocess> = new Map();
let isRestarting = false;
let launcherConfig: LauncherConfig;

function loadLauncherConfig(): LauncherConfig {
  const configPath = join(homedir(), ".adas", "config.json");
  const defaults: LauncherConfig = {
    port: 3998,
    token: "",
    aiWorkerEnabled: true,
    localWorkerEnabled: true,
    aiWorkerPort: 3100,
    localWorkerPort: 3200,
  };

  if (!existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    return {
      port: config.workerLauncher?.port ?? defaults.port,
      token: config.workerLauncher?.token ?? defaults.token,
      aiWorkerEnabled: config.workerLauncher?.aiWorkerEnabled ?? defaults.aiWorkerEnabled,
      localWorkerEnabled: config.workerLauncher?.localWorkerEnabled ?? defaults.localWorkerEnabled,
      aiWorkerPort: config.workerLauncher?.aiWorkerPort ?? defaults.aiWorkerPort,
      localWorkerPort: config.workerLauncher?.localWorkerPort ?? defaults.localWorkerPort,
    };
  } catch {
    return defaults;
  }
}

function getProcesses(): ProcessConfig[] {
  const processes: ProcessConfig[] = [];

  if (launcherConfig.aiWorkerEnabled) {
    processes.push({
      name: "ai-worker",
      command: ["bun", "run", "apps/ai-worker/src/index.ts"],
      env: { AI_WORKER_PORT: String(launcherConfig.aiWorkerPort) },
    });
  }

  if (launcherConfig.localWorkerEnabled) {
    processes.push({
      name: "local-worker",
      command: ["bun", "run", "apps/local-worker/src/index.ts"],
      env: { LOCAL_WORKER_PORT: String(launcherConfig.localWorkerPort) },
    });
  }

  return processes;
}

function log(message: string): void {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] [worker-launcher] ${message}`);
}

function startProcess(config: ProcessConfig): Subprocess {
  log(`Starting ${config.name}...`);

  const proc = Bun.spawn(config.command, {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...config.env, FORCE_COLOR: "1" },
    onExit: (_proc, exitCode, _signalCode, _error) => {
      if (!isRestarting) {
        log(`${config.name} exited with code ${exitCode}`);
        // 自動再起動
        setTimeout(() => {
          if (!isRestarting && !runningProcesses.get(config.name)?.killed === false) {
            log(`Auto-restarting ${config.name}...`);
            const newProc = startProcess(config);
            runningProcesses.set(config.name, newProc);
          }
        }, 2000);
      }
    },
  });

  return proc;
}

function startAllProcesses(): void {
  log("Starting all processes...");
  const processes = getProcesses();
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

async function stopProcess(name: string): Promise<boolean> {
  const proc = runningProcesses.get(name);
  if (!proc) {
    return false;
  }

  try {
    proc.kill("SIGTERM");
    const timeout = setTimeout(() => {
      log(`Force killing ${name}...`);
      proc.kill("SIGKILL");
    }, 5000);

    await proc.exited;
    clearTimeout(timeout);
    runningProcesses.delete(name);
    log(`${name} stopped`);
    return true;
  } catch {
    return false;
  }
}

async function restartProcess(name: string): Promise<boolean> {
  const processes = getProcesses();
  const config = processes.find((p) => p.name === name);
  if (!config) {
    return false;
  }

  await stopProcess(name);
  await Bun.sleep(500);

  const proc = startProcess(config);
  runningProcesses.set(name, proc);
  return true;
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

function validateToken(req: Request, expectedToken: string): boolean {
  if (!expectedToken) {
    return true;
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }

  return match[1] === expectedToken;
}

function startServer(config: LauncherConfig): void {
  const { port, token } = config;

  Bun.serve({
    hostname: "0.0.0.0",
    port,
    fetch: async (req) => {
      const url = new URL(req.url);

      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers });
      }

      // トークン認証 (restart エンドポイント)
      if (url.pathname.startsWith("/restart")) {
        if (!validateToken(req, token)) {
          log(`Unauthorized restart attempt from ${req.headers.get("x-forwarded-for") || "unknown"}`);
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...headers, "Content-Type": "application/json" },
          });
        }
      }

      // 全プロセス再起動
      if (url.pathname === "/restart" && req.method === "POST") {
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

      // 個別プロセス再起動
      const restartMatch = url.pathname.match(/^\/restart\/(.+)$/);
      if (restartMatch && req.method === "POST") {
        const processName = restartMatch[1];
        const success = await restartProcess(processName);
        if (success) {
          return new Response(
            JSON.stringify({ message: `${processName} restarted` }),
            { headers: { ...headers, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: `Process ${processName} not found` }),
          { status: 404, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }

      if (url.pathname === "/status") {
        const status = {
          type: "worker",
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

  log(`Worker Launcher listening on http://0.0.0.0:${port}`);
  log(`  POST /restart         - Restart all workers${token ? " (token required)" : ""}`);
  log(`  POST /restart/:name   - Restart specific worker`);
  log("  GET  /status          - Get process status");
}

// Graceful shutdown
process.on("SIGINT", async () => {
  log("Received SIGINT, shutting down...");
  isRestarting = true; // 自動再起動を防ぐ
  await stopAllProcesses();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  log("Received SIGTERM, shutting down...");
  isRestarting = true; // 自動再起動を防ぐ
  await stopAllProcesses();
  process.exit(0);
});

// Main
launcherConfig = loadLauncherConfig();

console.log("========================================");
console.log("  ADAS Worker Launcher");
console.log("  (ai-worker + local-worker)");
console.log("========================================");
console.log("");

startServer(launcherConfig);
startAllProcesses();

console.log("");
log("Ready! Press Ctrl+C to stop all processes");
