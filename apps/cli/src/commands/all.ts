import { basename } from "node:path";
import { serve } from "@hono/node-server";
import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { eq } from "drizzle-orm";
import { AudioCapture } from "../audio/capture.js";
import { loadConfig } from "../config.js";
import { createApp } from "../server/app.js";
import { startScheduler } from "../summarizer/scheduler.js";
import { getTodayDateString } from "../utils/date.js";
import { transcribeAudio } from "../whisper/client.js";

export function registerAllCommand(program: Command): void {
  program
    .command("all")
    .description("Start all services (record + transcribe + summarize + API server)")
    .option("-s, --source <source>", "PulseAudio source name")
    .option("-p, --port <port>", "API server port")
    .action(async (options: { source?: string; port?: string }) => {
      const config = loadConfig();
      const port = options.port ? Number.parseInt(options.port, 10) : config.server.port;
      const db = createDatabase(config.dbPath);

      // Start API server
      const app = createApp(db);
      serve({ fetch: app.fetch, port });
      consola.success(`API server running on http://localhost:${port}`);

      // Start summarization scheduler
      const stopScheduler = startScheduler(db);
      consola.success("Summarization scheduler started");

      // Start audio capture with auto-transcription
      const capture = new AudioCapture({
        source: options.source,
        config,
        onChunkComplete: async (filePath) => {
          try {
            const existing = db
              .select()
              .from(schema.transcriptionSegments)
              .where(eq(schema.transcriptionSegments.audioFilePath, filePath))
              .all();

            if (existing.length > 0) return;

            consola.start(`Transcribing: ${basename(filePath)}`);
            const result = await transcribeAudio(filePath, config);

            if (!result.text.trim()) {
              consola.warn(`No speech in ${basename(filePath)}`);
              return;
            }

            const datePart = filePath.split("/").at(-2) ?? getTodayDateString();
            const fileName = basename(filePath, ".wav");
            const timeParts = fileName.replace("chunk_", "").split("-");
            const startTimeStr = `${datePart}T${timeParts.join(":")}`;
            const startTime = new Date(startTimeStr);
            const endTime = new Date(
              startTime.getTime() + config.audio.chunkDurationMinutes * 60 * 1000,
            );

            db.insert(schema.transcriptionSegments)
              .values({
                date: datePart,
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                audioSource: options.source ?? "default",
                audioFilePath: filePath,
                transcription: result.text,
                language: result.language,
                confidence: null,
              })
              .run();

            consola.success(`Transcribed: ${basename(filePath)}`);
          } catch (err) {
            consola.error(`Transcription failed for ${basename(filePath)}:`, err);
          }
        },
      });

      consola.info("Starting audio capture (Ctrl+C to stop all services)");
      await capture.start();

      // Graceful shutdown
      const shutdown = async () => {
        consola.info("Shutting down all services...");
        await capture.stop();
        stopScheduler();
        consola.success("All services stopped");
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
