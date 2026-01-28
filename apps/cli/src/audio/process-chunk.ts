import { unlinkSync } from "node:fs";
import { basename } from "node:path";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";
import { transcribeAudio } from "../whisper/client.js";

/**
 * 録音チャンク完了時の共通処理: 文字起こし + DB 保存 + 音声ファイル削除。
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
  const result = await transcribeAudio(filePath, config);

  if (!result.text.trim()) {
    consola.warn(`No speech in ${basename(filePath)}`);
    unlinkSync(filePath);
    return;
  }

  const datePart = filePath.split("/").at(-2) ?? getTodayDateString();
  const fileName = basename(filePath, ".wav");
  const timeParts = fileName.replace("chunk_", "").split("-");
  const startTimeStr = `${datePart}T${timeParts.join(":")}`;
  const startTime = new Date(startTimeStr);
  const endTime = new Date(startTime.getTime() + config.audio.chunkDurationMinutes * 60 * 1000);

  const hasSpeakers = result.segments.some((s) => s.speaker);

  if (hasSpeakers) {
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
          speaker: seg.speaker ?? null,
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
        speaker: null,
      })
      .run();
  }

  consola.success(`Transcribed: ${basename(filePath)}`);
  consola.box(result.text);

  try {
    unlinkSync(filePath);
    consola.debug(`Deleted: ${basename(filePath)}`);
  } catch {
    consola.warn(`Failed to delete: ${basename(filePath)}`);
  }
}
