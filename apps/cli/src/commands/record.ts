import { serve } from "@hono/node-server";
import { setupFileLogger } from "@repo/core";
import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { AudioCapture, listAudioSources } from "../audio/capture.js";
import { processChunkComplete } from "../audio/process-chunk.js";
import { loadConfig } from "../config.js";
import { createApp } from "../server/app.js";
import { startScheduler } from "../summarizer/scheduler.js";

export function registerRecordCommand(program: Command): void {
  program
    .command("record")
    .description(
      "Start recording services (audio capture + transcription + API server + scheduler)",
    )
    .option("-s, --source <source>", "PulseAudio source name (default: auto-detect)")
    .option("-p, --port <port>", "API server port")
    .option("--list-sources", "List available PulseAudio sources")
    .action(async (options: { source?: string; port?: string; listSources?: boolean }) => {
      setupFileLogger();

      if (options.listSources) {
        const sources = await listAudioSources();
        consola.info("Available PulseAudio sources:");
        for (const src of sources) {
          consola.log(`  - ${src}`);
        }
        return;
      }

      const config = loadConfig();
      const port = options.port ? Number.parseInt(options.port, 10) : config.server.port;
      const db = createDatabase(config.dbPath);

      // Worker health check
      const workerUrl = config.worker.url;
      consola.start(`Checking worker at ${workerUrl}...`);
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
          `Worker connected (whisperx: ${health.whisperx}, claude: ${health.claude})`,
        );
      } catch (err) {
        consola.fatal(`Worker is not reachable at ${workerUrl}`);
        consola.fatal("Start the worker first: bun run cli -- worker");
        consola.fatal(`Error: ${err}`);
        process.exit(1);
      }

      // Start API server
      const app = createApp(db);
      serve({ fetch: app.fetch, port });
      consola.success(`API server running on http://localhost:${port}`);

      // Start summarization scheduler
      const stopScheduler = startScheduler(db);
      consola.success("Summarization scheduler started");

      // Start audio capture with auto-transcription
      const audioSource = options.source ?? "default";
      const capture = new AudioCapture({
        source: options.source,
        config,
        onChunkComplete: async (filePath) => {
          try {
            await processChunkComplete(filePath, config, db, audioSource);
          } catch (err) {
            consola.error(`Transcription failed for ${filePath}:`, err);
          }
        },
      });

      consola.info("Starting audio capture (Ctrl+C to stop)");
      await capture.start();

      // Graceful shutdown
      const shutdown = async () => {
        consola.info("Shutting down recording services...");
        await capture.stop();
        stopScheduler();
        consola.success("All recording services stopped");
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
