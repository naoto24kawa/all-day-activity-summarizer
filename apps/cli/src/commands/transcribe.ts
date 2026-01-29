import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { interpretSegments } from "../interpreter/run.js";
import { checkAndAutoImprove } from "../prompts/auto-trigger.js";
import { runAsyncEvaluation } from "../transcription/evaluation-pipeline.js";
import { getDateString, getTodayDateString } from "../utils/date.js";
import { transcribeAudio } from "../whisper/client.js";
import { isHallucination } from "../whisper/hallucination-filter.js";
import { buildInitialPrompt } from "./vocab.js";

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

      // 自動プロンプト改善トリガー
      if (config.promptImprovement?.enabled) {
        checkAndAutoImprove(db, config.promptImprovement.badFeedbackThreshold).then(
          () => {},
          (err) => consola.warn("[auto-improve] Auto-improvement failed:", err),
        );
      }
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

  // vocabulary から initial_prompt を生成
  const initialPrompt = buildInitialPrompt(db);
  const result = await transcribeAudio(filePath, config, initialPrompt);

  if (isHallucination(result.text)) {
    consola.warn(`No speech detected in ${basename(filePath)}`);
    return;
  }

  // ファイル名から録音情報を抽出
  // 例: "2025-01-29/chunk_14-30-00_mic.wav"
  //   -> datePart: "2025-01-29", startTime: "14:30:00", sourceType: "mic"
  const fileName = basename(filePath, ".wav");
  // 親ディレクトリ名が日付 (例: "2025-01-29")
  const datePart = filePath.split("/").at(-2) ?? getTodayDateString();
  // ファイル名から時刻を抽出: "chunk_14-30-00_mic" -> "14-30-00" -> "14:30:00"
  const timeStr = fileName.replace("chunk_", "").replace(/_(?:mic|speaker)$/, "");
  const timeParts = timeStr.split("-");
  const startTimeStr = `${datePart}T${timeParts.join(":")}`;
  // チャンクの開始・終了時刻を計算
  const startTime = new Date(startTimeStr);
  const endTime = new Date(startTime.getTime() + config.audio.chunkDurationMinutes * 60 * 1000);
  // 音声ソースタイプを判定 (マイク or スピーカー)
  const isMicSource = fileName.endsWith("_mic");

  // マイク音声は "Me" に固定
  const speaker = isMicSource ? "Me" : null;

  // セグメント単位で保存
  if (result.segments.length > 0) {
    for (const seg of result.segments) {
      if (isHallucination(seg.text)) continue;
      const segStart = new Date(startTime.getTime() + seg.start);
      const segEnd = new Date(startTime.getTime() + seg.end);
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
          speaker,
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
        speaker,
      })
      .run();
  }

  consola.success(`Transcribed: ${basename(filePath)} (${result.text.length} chars)`);

  // 第2段階: Claude SDK による非同期ハルシネーション評価 → interpret の直列実行
  // ハルシネーション判定で削除された場合は interpret をスキップ
  runAsyncEvaluationAndInterpret(result.text, result.segments, filePath, config, db).then(
    () => {},
    (err) => consola.warn(`[evaluator/interpret] Pipeline failed for ${basename(filePath)}:`, err),
  );
}

/**
 * evaluator -> interpret の直列パイプライン。
 * ハルシネーション判定で削除されたセグメントは interpret をスキップ。
 */
async function runAsyncEvaluationAndInterpret(
  text: string,
  segments: { text: string; start: number; end: number }[],
  filePath: string,
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<void> {
  // Step 1: evaluator でハルシネーション判定 (セグメント単位で削除)
  await runAsyncEvaluation(text, segments, filePath, config, db);

  // Step 2: 残っているセグメントに対して interpret を実行
  const uninterpreted = db
    .select()
    .from(schema.transcriptionSegments)
    .where(eq(schema.transcriptionSegments.audioFilePath, filePath))
    .all()
    .filter((s) => !s.interpretedText);

  if (uninterpreted.length > 0) {
    const { success, fail } = await interpretSegments(uninterpreted, config, db);
    consola.info(
      `[interpret] Interpretation complete for ${basename(filePath)} (${success} succeeded, ${fail} failed)`,
    );
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
