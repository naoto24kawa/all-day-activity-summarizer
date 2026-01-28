import { serve } from "@hono/node-server";
import { setupFileLogger } from "@repo/core";
import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { AudioCapture } from "../audio/capture.js";
import { processChunkComplete } from "../audio/process-chunk.js";
import { loadConfig } from "../config.js";
import { createApp } from "../server/app.js";
import { startScheduler } from "../summarizer/scheduler.js";

export function registerAllCommand(program: Command): void {
  program
    .command("all")
    .description("Start all services (worker + record + transcribe + summarize + API server)")
    .option("-s, --source <source>", "PulseAudio source name (alias for --mic-source)")
    .option("--mic-source <micSource>", "Microphone source name")
    .option("--speaker-source <speakerSource>", "Speaker/system audio source name")
    .option("-p, --port <port>", "API server port")
    .option("--worker-port <workerPort>", "Worker server port", "3100")
    .action(
      async (options: {
        source?: string;
        micSource?: string;
        speakerSource?: string;
        port?: string;
        workerPort: string;
      }) => {
        setupFileLogger();

        const config = loadConfig();
        const port = options.port ? Number.parseInt(options.port, 10) : config.server.port;
        const workerPort = Number.parseInt(options.workerPort, 10);
        const db = createDatabase(config.dbPath);

        // Start worker server as a child process
        consola.start("Starting worker server...");
        const workerProc = Bun.spawn(["bun", "run", "apps/worker/src/index.ts"], {
          env: { ...process.env, WORKER_PORT: String(workerPort) },
          stdout: "inherit",
          stderr: "inherit",
        });
        consola.success(`Worker process started (pid: ${workerProc.pid})`);

        // Wait briefly for worker to start
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Worker health check
        const workerUrl = config.worker.url;
        try {
          const healthRes = await fetch(`${workerUrl}/rpc/health`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!healthRes.ok) {
            throw new Error(`Worker returned ${healthRes.status}`);
          }
          const health = (await healthRes.json()) as {
            status: string;
            whisperx: boolean;
            claude: boolean;
          };
          consola.success(
            `Worker health OK (whisperx: ${health.whisperx}, claude: ${health.claude})`,
          );
        } catch (err) {
          consola.fatal(`Worker health check failed: ${err}`);
          workerProc.kill();
          process.exit(1);
        }

        // Resolve sources (--source is alias for --mic-source)
        // If nothing specified, both default to undefined (auto-detect)
        const micSource = options.micSource ?? options.source;
        const speakerSource = options.speakerSource;

        // Create audio capture instances (always both)
        const micCapture = new AudioCapture({
          source: micSource,
          sourceType: "mic",
          config,
          onChunkComplete: async (filePath) => {
            try {
              await processChunkComplete(filePath, config, db, "mic");
            } catch (err) {
              consola.error(`Transcription failed for ${filePath}:`, err);
            }
          },
        });
        consola.info(`Mic capture configured (source: ${micSource ?? "default"})`);

        const speakerCapture = new AudioCapture({
          source: speakerSource,
          sourceType: "speaker",
          config,
          onChunkComplete: async (filePath) => {
            try {
              await processChunkComplete(filePath, config, db, "speaker");
            } catch (err) {
              consola.error(`Transcription failed for ${filePath}:`, err);
            }
          },
        });
        consola.info(`Speaker capture configured (source: ${speakerSource ?? "default"})`);

        // Start API server
        const app = createApp(db, { micCapture, speakerCapture });
        serve({ fetch: app.fetch, port });
        consola.success(`API server running on http://localhost:${port}`);

        // Start summarization scheduler
        const stopScheduler = startScheduler(db);
        consola.success("Summarization scheduler started");

        // Start audio captures
        consola.info("Starting audio capture (Ctrl+C to stop all services)");
        const startPromises: Promise<void>[] = [];
        if (micCapture) startPromises.push(micCapture.start());
        if (speakerCapture) startPromises.push(speakerCapture.start());
        await Promise.all(startPromises);

        // Graceful shutdown
        const shutdown = async () => {
          consola.info("Shutting down all services...");
          const stopPromises: Promise<void>[] = [];
          if (micCapture) stopPromises.push(micCapture.stop());
          if (speakerCapture) stopPromises.push(speakerCapture.stop());
          await Promise.all(stopPromises);
          stopScheduler();
          workerProc.kill();
          consola.success("All services stopped");
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      },
    );
}
