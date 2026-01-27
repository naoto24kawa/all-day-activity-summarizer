import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { getDateString, getTodayDateString } from "../utils/date.js";
import { transcribeAudio } from "../whisper/client.js";

export function registerTranscribeCommand(program: Command): void {
  program
    .command("transcribe")
    .description("Transcribe audio files using whisper.cpp")
    .option("-d, --date <date>", "Date to transcribe (YYYY-MM-DD or 'today')", "today")
    .option("-f, --file <file>", "Transcribe a specific file")
    .option("--watch", "Watch for new recordings and transcribe automatically")
    .action(async (options: { date?: string; file?: string; watch?: boolean }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      if (options.file) {
        await transcribeFile(options.file, config, db);
        return;
      }

      if (options.watch) {
        consola.info("Watching for new recordings...");
        await watchAndTranscribe(config, db);
        return;
      }

      const dateStr = getDateString(options.date);
      const dateDir = join(config.recordingsDir, dateStr);

      if (!existsSync(dateDir)) {
        consola.warn(`No recordings found for ${dateStr}`);
        return;
      }

      const wavFiles = readdirSync(dateDir)
        .filter((f) => f.endsWith(".wav"))
        .sort();

      if (wavFiles.length === 0) {
        consola.warn(`No WAV files found in ${dateDir}`);
        return;
      }

      consola.info(`Found ${wavFiles.length} WAV files for ${dateStr}`);

      for (const file of wavFiles) {
        const filePath = join(dateDir, file);
        await transcribeFile(filePath, config, db);
      }

      consola.success(`Transcription complete for ${dateStr}`);
    });
}

async function transcribeFile(
  filePath: string,
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<void> {
  // Check if already transcribed
  const existing = db
    .select()
    .from(schema.transcriptionSegments)
    .where(eq(schema.transcriptionSegments.audioFilePath, filePath))
    .all();

  if (existing.length > 0) {
    consola.debug(`Already transcribed: ${basename(filePath)}`);
    return;
  }

  consola.start(`Transcribing: ${basename(filePath)}`);

  const result = await transcribeAudio(filePath, config);

  if (!result.text.trim()) {
    consola.warn(`No speech detected in ${basename(filePath)}`);
    return;
  }

  // Extract date and time from filename (chunk_HH-MM-SS.wav)
  const fileName = basename(filePath, ".wav");
  const datePart = filePath.split("/").at(-2) ?? getTodayDateString();
  const timeParts = fileName.replace("chunk_", "").split("-");
  const startTimeStr = `${datePart}T${timeParts.join(":")}`;
  const startTime = new Date(startTimeStr);
  const endTime = new Date(startTime.getTime() + config.audio.chunkDurationMinutes * 60 * 1000);

  db.insert(schema.transcriptionSegments)
    .values({
      date: datePart,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      audioSource: "default",
      audioFilePath: filePath,
      transcription: result.text,
      language: result.language,
      confidence: null,
    })
    .run();

  consola.success(`Transcribed: ${basename(filePath)} (${result.text.length} chars)`);
}

async function watchAndTranscribe(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<void> {
  const processedFiles = new Set<string>();

  const checkForNewFiles = async () => {
    const dateStr = getTodayDateString();
    const dateDir = join(config.recordingsDir, dateStr);

    if (!existsSync(dateDir)) return;

    const wavFiles = readdirSync(dateDir)
      .filter((f) => f.endsWith(".wav"))
      .sort();

    for (const file of wavFiles) {
      const filePath = join(dateDir, file);
      if (processedFiles.has(filePath)) continue;
      processedFiles.add(filePath);

      try {
        await transcribeFile(filePath, config, db);
      } catch (err) {
        consola.error(`Failed to transcribe ${file}:`, err);
      }
    }
  };

  // Check every 30 seconds
  const interval = setInterval(checkForNewFiles, 30_000);
  await checkForNewFiles();

  const shutdown = () => {
    clearInterval(interval);
    consola.info("Watcher stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep alive
  await new Promise(() => {});
}
