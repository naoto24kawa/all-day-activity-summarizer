import { serve } from "@hono/node-server";
import { setupFileLogger } from "@repo/core";
import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { AudioCapture, listAudioSources } from "../audio/capture.js";
import { AudioLevelMonitor, getMonitor, setMonitor } from "../audio/level-monitor.js";
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
    .option("-s, --source <source>", "PulseAudio source name (alias for --mic-source)")
    .option("--mic-source <micSource>", "Microphone source name")
    .option("--speaker-source <speakerSource>", "Speaker/system audio source name")
    .option("-p, --port <port>", "API server port")
    .option("--list-sources", "List available PulseAudio sources")
    .action(
      async (options: {
        source?: string;
        micSource?: string;
        speakerSource?: string;
        port?: string;
        listSources?: boolean;
      }) => {
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
        const app = createApp(db, {
          micCapture,
          speakerCapture,
          micSource: micSource ?? "default",
          speakerSource: speakerSource ?? "default",
          config,
        });
        serve({ fetch: app.fetch, port });
        consola.success(`API server running on http://localhost:${port}`);

        // Start summarization scheduler
        const stopScheduler = startScheduler(db);
        consola.success("Summarization scheduler started");

        // Start audio captures and level monitors
        consola.info("Starting audio capture (Ctrl+C to stop)");
        const startPromises: Promise<void>[] = [];
        if (micCapture) {
          startPromises.push(micCapture.start());
          const micMonitor = new AudioLevelMonitor({
            source: micSource ?? "default",
            type: "mic",
          });
          setMonitor("mic", micMonitor);
          startPromises.push(micMonitor.start());
        }
        if (speakerCapture) {
          startPromises.push(speakerCapture.start());
          const speakerMonitor = new AudioLevelMonitor({
            source: speakerSource ?? "default",
            type: "speaker",
          });
          setMonitor("speaker", speakerMonitor);
          startPromises.push(speakerMonitor.start());
        }
        await Promise.all(startPromises);

        // Graceful shutdown
        const shutdown = async () => {
          consola.info("Shutting down recording services...");
          const stopPromises: Promise<void>[] = [];
          if (micCapture) stopPromises.push(micCapture.stop());
          if (speakerCapture) stopPromises.push(speakerCapture.stop());
          const micMonitor = getMonitor("mic");
          const speakerMonitor = getMonitor("speaker");
          if (micMonitor) stopPromises.push(micMonitor.stop());
          if (speakerMonitor) stopPromises.push(speakerMonitor.stop());
          await Promise.all(stopPromises);
          stopScheduler();
          consola.success("All recording services stopped");
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      },
    );
}
