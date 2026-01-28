import type { Command } from "commander";
import consola from "consola";

export function registerWorkerCommand(program: Command): void {
  program
    .command("worker")
    .description("Start the RPC worker server (WhisperX + Claude)")
    .option("-p, --port <port>", "Worker server port", "3100")
    .action(async (options: { port: string }) => {
      const port = Number.parseInt(options.port, 10);

      consola.info(`Starting worker server on port ${port}...`);

      const workerProc = Bun.spawn(["bun", "run", "apps/worker/src/index.ts"], {
        env: { ...process.env, WORKER_PORT: String(port) },
        stdout: "inherit",
        stderr: "inherit",
      });

      consola.success(`Worker process started (pid: ${workerProc.pid})`);
      consola.info("Endpoints:");
      consola.info("  POST /rpc/transcribe  - WhisperX transcription");
      consola.info("  POST /rpc/summarize   - Claude summarization");
      consola.info("  POST /rpc/evaluate    - Hallucination evaluation");
      consola.info("  GET  /rpc/health      - Health check");
      consola.info("");
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
