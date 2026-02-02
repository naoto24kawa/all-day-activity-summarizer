import type { Command } from "commander";
import consola from "consola";

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
      consola.info("Endpoints:");
      consola.info("  POST /rpc/summarize   - Claude summarization");
      consola.info("  POST /rpc/evaluate    - Hallucination evaluation");
      consola.info("  POST /rpc/interpret   - Text interpretation");
      consola.info("  POST /rpc/extract-terms - Vocabulary extraction");
      consola.info("  GET  /rpc/health      - Health check");
      consola.info("");
      consola.info("Press Ctrl+C to stop");

      // Graceful shutdown
      const shutdown = () => {
        consola.info("Shutting down AI Worker server...");
        workerProc.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Wait for worker process to exit
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
      consola.info("Endpoints:");
      consola.info("  POST /rpc/transcribe  - WhisperX transcription");
      consola.info("  POST /rpc/tokenize    - Kuromoji tokenization");
      consola.info("  GET  /rpc/health      - Health check");
      consola.info("");
      consola.info("Press Ctrl+C to stop");

      // Graceful shutdown
      const shutdown = () => {
        consola.info("Shutting down Local Worker server...");
        workerProc.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Wait for worker process to exit
      await workerProc.exited;
    });

  // workers コマンド (両方同時起動)
  program
    .command("workers")
    .description("Start both AI Worker and Local Worker servers")
    .option("--ai-port <port>", "AI Worker server port", "3100")
    .option("--local-port <port>", "Local Worker server port", "3200")
    .action(async (options: { aiPort: string; localPort: string }) => {
      const aiPort = Number.parseInt(options.aiPort, 10);
      const localPort = Number.parseInt(options.localPort, 10);

      consola.info(`Starting workers... AI: ${aiPort}, Local: ${localPort}`);

      const aiWorkerProc = Bun.spawn(["bun", "run", "apps/ai-worker/src/index.ts"], {
        env: { ...process.env, AI_WORKER_PORT: String(aiPort) },
        stdout: "inherit",
        stderr: "inherit",
      });

      const localWorkerProc = Bun.spawn(["bun", "run", "apps/local-worker/src/index.ts"], {
        env: { ...process.env, LOCAL_WORKER_PORT: String(localPort) },
        stdout: "inherit",
        stderr: "inherit",
      });

      consola.success(`AI Worker started (pid: ${aiWorkerProc.pid})`);
      consola.success(`Local Worker started (pid: ${localWorkerProc.pid})`);
      consola.info("");
      consola.info("Press Ctrl+C to stop both workers");

      // Graceful shutdown
      const shutdown = () => {
        consola.info("Shutting down workers...");
        aiWorkerProc.kill();
        localWorkerProc.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Wait for either worker to exit
      await Promise.race([aiWorkerProc.exited, localWorkerProc.exited]);
    });

  // 互換性のため worker コマンドも残す (ai-worker のエイリアス)
  program
    .command("worker")
    .description("Start the AI RPC worker server (alias for ai-worker)")
    .option("-p, --port <port>", "Worker server port", "3100")
    .action(async (options: { port: string }) => {
      const port = Number.parseInt(options.port, 10);

      consola.info(`Starting worker server on port ${port}...`);
      consola.warn("Note: 'worker' command is deprecated. Use 'ai-worker' instead.");

      const workerProc = Bun.spawn(["bun", "run", "apps/ai-worker/src/index.ts"], {
        env: { ...process.env, AI_WORKER_PORT: String(port) },
        stdout: "inherit",
        stderr: "inherit",
      });

      consola.success(`Worker process started (pid: ${workerProc.pid})`);
      consola.info("Press Ctrl+C to stop");

      // Graceful shutdown
      const shutdown = () => {
        consola.info("Shutting down worker server...");
        workerProc.kill();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Wait for worker process to exit
      await workerProc.exited;
    });
}
