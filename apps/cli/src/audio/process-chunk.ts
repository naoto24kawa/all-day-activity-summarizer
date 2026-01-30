import { unlinkSync } from "node:fs";
import { basename } from "node:path";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import { buildInitialPrompt } from "../commands/vocab.js";
import type { AdasConfig } from "../config.js";
import { runAsyncEvaluation } from "../transcription/evaluation-pipeline.js";
import { getTodayDateString } from "../utils/date.js";
import { transcribeAudio } from "../whisper/client.js";

/**
 * 録音チャンク完了時の共通処理: 文字起こし + DB 保存 + 評価 + 音声ファイル削除。
 * record コマンドと all コマンドで共有する。
 */
export async function processChunkComplete(
  filePath: string,
  config: AdasConfig,
  db: AdasDatabase,
  audioSource: string,
): Promise<void> {
  const existing = db
    .select()
    .from(schema.transcriptionSegments)
    .where(eq(schema.transcriptionSegments.audioFilePath, filePath))
    .all();

  if (existing.length > 0) return;

  consola.start(`Transcribing: ${basename(filePath)}`);

  // vocabulary から initial_prompt を生成
  const initialPrompt = buildInitialPrompt(db);
  const result = await transcribeAudio(filePath, config, initialPrompt);

  if (!result.text.trim()) {
    consola.warn(`No speech in ${basename(filePath)}`);
    unlinkSync(filePath);
    return;
  }

  // ファイル名から録音情報を抽出
  // 例: "2025-01-29/chunk_14-30-00_mic.wav"
  //   -> datePart: "2025-01-29", startTime: "14:30:00"
  const datePart = filePath.split("/").at(-2) ?? getTodayDateString();
  const fileName = basename(filePath, ".wav");
  // ファイル名から時刻を抽出: "chunk_14-30-00_mic" -> "14-30-00" -> "14:30:00"
  const timeStr = fileName.replace("chunk_", "").replace(/_(?:mic|speaker)$/, "");
  const timeParts = timeStr.split("-");
  const startTimeStr = `${datePart}T${timeParts.join(":")}`;
  // チャンクの開始・終了時刻を計算
  const startTime = new Date(startTimeStr);
  const endTime = new Date(startTime.getTime() + config.audio.chunkDurationMinutes * 60 * 1000);

  // マイク音声は "Me" に固定
  const speaker = audioSource === "mic" ? "Me" : null;

  // セグメント単位で保存
  if (result.segments.length > 0) {
    for (const seg of result.segments) {
      if (!seg.text.trim()) continue;
      const segStart = new Date(startTime.getTime() + seg.start);
      const segEnd = new Date(startTime.getTime() + seg.end);
      db.insert(schema.transcriptionSegments)
        .values({
          date: datePart,
          startTime: segStart.toISOString(),
          endTime: segEnd.toISOString(),
          audioSource,
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
        audioSource,
        audioFilePath: filePath,
        transcription: result.text,
        language: result.language,
        confidence: null,
        speaker,
      })
      .run();
  }

  consola.success(`Transcribed: ${basename(filePath)}`);
  consola.box(result.text);

  try {
    unlinkSync(filePath);
    consola.debug(`Deleted: ${basename(filePath)}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    consola.warn(`Failed to delete: ${basename(filePath)} - ${errMsg}`);
  }

  // 第2段階: Claude SDK による非同期ハルシネーション評価
  if (config.evaluator?.enabled !== false) {
    runAsyncEvaluation(result.text, result.segments, filePath, config, db).then(
      () => {},
      (err) => consola.warn(`[evaluator] Evaluation failed for ${basename(filePath)}:`, err),
    );
  }
}
