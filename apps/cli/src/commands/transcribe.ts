import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { getDateString, getTodayDateString } from "../utils/date.js";
import { transcribeAudio } from "../whisper/client.js";
import { applyNewPattern, evaluateTranscription } from "../whisper/evaluator.js";
import { accumulateSpeakerEmbeddings, loadRegisteredEmbeddings } from "../whisper/speaker-store.js";

/**
 * Whisper が無音区間で出力するハルシネーションパターン。
 * 同一フレーズの繰り返しや定型文を検出して除外する。
 */
const HALLUCINATION_PATTERNS = [
  /^(ご視聴ありがとうございました[\s。]*)+$/,
  /^(ありがとうございました[\s。]*)+$/,
  /^(チャンネル登録お願いします[\s。]*)+$/,
  /^(お疲れ様でした[\s。]*)+$/,
  /^(おやすみなさい[\s。]*)+$/,
  /^(Thank you for watching[\s.]*)+$/i,
  /^(Thanks for watching[\s.]*)+$/i,
  /^(Subscribe[\s.]*)+$/i,
  /^(\.+\s*)+$/,
];

function isHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

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

  if (isHallucination(result.text)) {
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

  // 話者 embedding を処理し、ラベルを登録名に差替え(DB 挿入前に実行)
  let labelMap: Record<string, string> = {};
  if (result.speakerEmbeddings && Object.keys(result.speakerEmbeddings).length > 0) {
    try {
      const speakerTexts: Record<string, string[]> = {};
      for (const seg of result.segments) {
        if (seg.speaker && seg.text.trim()) {
          if (!speakerTexts[seg.speaker]) {
            speakerTexts[seg.speaker] = [];
          }
          speakerTexts[seg.speaker]?.push(seg.text.trim());
        }
      }
      const registeredEmbeddings = loadRegisteredEmbeddings();
      labelMap = accumulateSpeakerEmbeddings(
        result.speakerEmbeddings,
        speakerTexts,
        registeredEmbeddings,
      );
    } catch (err) {
      consola.warn(`Failed to accumulate speaker embeddings: ${err}`);
    }
  }

  const hasSpeakers = result.segments.some((s) => s.speaker);

  if (hasSpeakers) {
    for (const seg of result.segments) {
      if (isHallucination(seg.text)) continue;
      const segStart = new Date(startTime.getTime() + seg.start);
      const segEnd = new Date(startTime.getTime() + seg.end);
      // ラベルを登録名に差替え
      const speaker = seg.speaker && labelMap[seg.speaker] ? labelMap[seg.speaker] : seg.speaker;
      db.insert(schema.transcriptionSegments)
        .values({
          date: datePart,
          startTime: segStart.toISOString(),
          endTime: segEnd.toISOString(),
          audioSource: "default",
          audioFilePath: filePath,
          transcription: seg.text,
          language: result.language,
          confidence: null,
          speaker: speaker ?? null,
        })
        .run();
    }
  } else {
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
        speaker: null,
      })
      .run();
  }

  consola.success(`Transcribed: ${basename(filePath)} (${result.text.length} chars)`);

  // 第2段階: Claude SDK による非同期ハルシネーション評価
  if (config.evaluator?.enabled !== false) {
    runAsyncEvaluation(result.text, result.segments, filePath, config, db).then(
      () => {},
      (err) => consola.warn(`[evaluator] Evaluation failed for ${basename(filePath)}:`, err),
    );
  }
}

async function runAsyncEvaluation(
  text: string,
  segments: { text: string; start: number; end: number; speaker?: string }[],
  filePath: string,
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<void> {
  const datePart = filePath.split("/").at(-2) ?? "";
  const evaluation = await evaluateTranscription(text, segments, {
    db,
    date: datePart,
    audioFilePath: filePath,
  });

  if (evaluation.judgment !== "hallucination" || evaluation.confidence < 0.7) {
    consola.info(
      `[evaluator] Passed: ${basename(filePath)} (${evaluation.judgment}, confidence: ${evaluation.confidence})`,
    );
    return;
  }

  consola.warn(`Hallucination detected by evaluator: ${basename(filePath)} - ${evaluation.reason}`);

  // DB からセグメントを削除
  db.delete(schema.transcriptionSegments)
    .where(eq(schema.transcriptionSegments.audioFilePath, filePath))
    .run();
  consola.info(`Removed hallucinated segments for ${basename(filePath)}`);

  // 新しいパターンを自動適用
  if (config.evaluator?.autoApplyPatterns !== false && evaluation.suggestedPattern) {
    const projectRoot = resolve(import.meta.dirname, "../../../../");
    await applyNewPattern(evaluation.suggestedPattern, evaluation.reason, projectRoot, {
      db,
      audioFilePath: filePath,
    });
    consola.success(`New hallucination pattern applied: ${evaluation.suggestedPattern}`);
  }
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
