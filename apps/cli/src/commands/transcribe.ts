import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { interpretSegments } from "../interpreter/run.js";
import { checkAndAutoImprove } from "../prompts/auto-trigger.js";
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
  /^(ティムマクローはこう言ってた[ティムマクローはこう言ってた]+[\s.]*)+$/,
  /^(レベルは死んだ囮のようです[\s.]*)+$/,
  /^(Thank you for watching[\s.]*)+$/i,
  /^(Thanks for watching[\s.]*)+$/i,
  /^(Subscribe[\s.]*)+$/i,
  /^(\.+\s*)+$/,
  /^(自分の.*?自分の.*?自分の.*?自分の.*?自分の.*?自分の[\s.]*)+$/,
  /^(子がいる(子がいる){4,}|ご視聴ありがとうございました|やめて(やめて){2,}[\s.]*)+$/,
  /^(あ{5,}|お店(お店){5,}[\s.]*)+$/,
  /^(いったんぽい!\s*)+$/,
  /^((ブーブー|でこれもっかり|仕組み立っているとも信頼なもあだれ|本気がいい)[\s.]*)+$/,
  /^((?:スパイク成功|応援が必要|北に向かっている|ニカラ活躍業員者|サージェンのシェルドン|オンラインカジノ)[\s.]*)+$/,
  // 汎用繰り返しノイズパターン: 同じ文字/音節が5回以上連続
  /(.)\1{4,}/, // 同じ1文字が5回以上連続 (例: あああああ)
  /(.{2,4})\1{4,}/, // 同じ2-4文字が5回以上連続 (例: 込み込み込み込み込み)
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

  const result = await transcribeAudio(filePath, config);

  if (isHallucination(result.text)) {
    consola.warn(`No speech detected in ${basename(filePath)}`);
    return;
  }

  // Extract date, time, and source type from filename (chunk_HH-MM-SS_mic.wav or chunk_HH-MM-SS_speaker.wav)
  const fileName = basename(filePath, ".wav");
  const datePart = filePath.split("/").at(-2) ?? getTodayDateString();
  // Remove chunk_ prefix and _mic/_speaker suffix to extract time
  const timeStr = fileName.replace("chunk_", "").replace(/_(?:mic|speaker)$/, "");
  const timeParts = timeStr.split("-");
  const startTimeStr = `${datePart}T${timeParts.join(":")}`;
  const startTime = new Date(startTimeStr);
  const endTime = new Date(startTime.getTime() + config.audio.chunkDurationMinutes * 60 * 1000);
  // Determine source type from filename
  const isMicSource = fileName.endsWith("_mic");

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
      // マイク音声は "Me" に固定、それ以外はラベルを登録名に差替え
      const speaker = isMicSource
        ? "Me"
        : seg.speaker && labelMap[seg.speaker]
          ? labelMap[seg.speaker]
          : seg.speaker;
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
        speaker: isMicSource ? "Me" : null,
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
 * evaluator → interpret の直列パイプライン。
 * ハルシネーション判定で削除されたセグメントは interpret をスキップ。
 */
async function runAsyncEvaluationAndInterpret(
  text: string,
  segments: { text: string; start: number; end: number; speaker?: string }[],
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

/**
 * @returns ハルシネーションと判定されたセグメントの index 配列 (削除済み)
 */
async function runAsyncEvaluation(
  text: string,
  segments: { text: string; start: number; end: number; speaker?: string }[],
  filePath: string,
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<number[]> {
  // evaluator が無効の場合は空配列を返す
  if (config.evaluator?.enabled === false) {
    return [];
  }

  const datePart = filePath.split("/").at(-2) ?? "";
  const evaluation = await evaluateTranscription(text, segments, {
    db,
    date: datePart,
    audioFilePath: filePath,
  });

  // legitimate の場合は何も削除しない
  if (evaluation.judgment === "legitimate") {
    consola.info(
      `[evaluator] Passed: ${basename(filePath)} (${evaluation.judgment}, confidence: ${evaluation.confidence})`,
    );
    return [];
  }

  // DB からセグメントを取得 (id 順)
  const dbSegments = db
    .select()
    .from(schema.transcriptionSegments)
    .where(eq(schema.transcriptionSegments.audioFilePath, filePath))
    .all();

  // segmentEvaluations がない場合は旧ロジック (全削除)
  if (!evaluation.segmentEvaluations || evaluation.segmentEvaluations.length === 0) {
    if (evaluation.judgment === "hallucination" && evaluation.confidence >= 0.7) {
      consola.warn(
        `Hallucination detected by evaluator: ${basename(filePath)} - ${evaluation.reason}`,
      );
      db.delete(schema.transcriptionSegments)
        .where(eq(schema.transcriptionSegments.audioFilePath, filePath))
        .run();
      consola.info(`Removed all segments for ${basename(filePath)}`);

      if (config.evaluator?.autoApplyPatterns !== false && evaluation.suggestedPattern) {
        const projectRoot = resolve(import.meta.dirname, "../../../../");
        await applyNewPattern(evaluation.suggestedPattern, evaluation.reason, projectRoot, {
          db,
          audioFilePath: filePath,
        });
        consola.success(`New hallucination pattern applied: ${evaluation.suggestedPattern}`);
      }
      return segments.map((_, i) => i);
    }
    return [];
  }

  // セグメント単位で削除
  const hallucinatedIndices: number[] = [];
  const patternsToApply: { pattern: string; reason: string }[] = [];

  for (const segEval of evaluation.segmentEvaluations) {
    if (segEval.judgment === "hallucination" && segEval.confidence >= 0.7) {
      hallucinatedIndices.push(segEval.index);
      const dbSeg = dbSegments[segEval.index];
      if (dbSeg) {
        db.delete(schema.transcriptionSegments)
          .where(eq(schema.transcriptionSegments.id, dbSeg.id))
          .run();
        consola.warn(
          `[evaluator] Removed segment #${segEval.index}: "${dbSeg.transcription?.slice(0, 30)}..." - ${segEval.reason}`,
        );
      }
      if (segEval.suggestedPattern) {
        patternsToApply.push({ pattern: segEval.suggestedPattern, reason: segEval.reason });
      }
    }
  }

  if (hallucinatedIndices.length > 0) {
    consola.info(
      `[evaluator] Removed ${hallucinatedIndices.length}/${segments.length} hallucinated segments for ${basename(filePath)}`,
    );
  } else {
    consola.info(
      `[evaluator] Passed: ${basename(filePath)} (${evaluation.judgment}, no high-confidence hallucinations)`,
    );
  }

  // 新しいパターンを自動適用 (重複排除)
  if (config.evaluator?.autoApplyPatterns !== false && patternsToApply.length > 0) {
    const uniquePatterns = [...new Map(patternsToApply.map((p) => [p.pattern, p])).values()];
    const projectRoot = resolve(import.meta.dirname, "../../../../");
    for (const { pattern, reason } of uniquePatterns) {
      await applyNewPattern(pattern, reason, projectRoot, { db, audioFilePath: filePath });
      consola.success(`New hallucination pattern applied: ${pattern}`);
    }
  }

  return hallucinatedIndices;
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
