import { unlinkSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";
import { transcribeAudio } from "../whisper/client.js";
import { applyNewPattern, evaluateTranscription } from "../whisper/evaluator.js";
import { accumulateSpeakerEmbeddings, loadRegisteredEmbeddings } from "../whisper/speaker-store.js";

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
      if (!seg.text.trim()) continue;
      const segStart = new Date(startTime.getTime() + seg.start);
      const segEnd = new Date(startTime.getTime() + seg.end);
      const speaker = seg.speaker && labelMap[seg.speaker] ? labelMap[seg.speaker] : seg.speaker;
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
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    consola.warn(`Failed to delete: ${basename(filePath)} - ${errMsg}`);
  }

  // 第2段階: Claude SDK による非同期ハルシネーション評価
  if (config.evaluator?.enabled !== false) {
    runAsyncEvaluation(result.text, result.segments, filePath, datePart, config, db).then(
      () => {},
      (err) => consola.warn(`[evaluator] Evaluation failed for ${basename(filePath)}:`, err),
    );
  }
}

async function runAsyncEvaluation(
  text: string,
  segments: { text: string; start: number; end: number; speaker?: string }[],
  filePath: string,
  datePart: string,
  config: AdasConfig,
  db: AdasDatabase,
): Promise<void> {
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
    return;
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
    }
    return;
  }

  // セグメント単位で削除
  const patternsToApply: { pattern: string; reason: string }[] = [];
  let removedCount = 0;

  for (const segEval of evaluation.segmentEvaluations) {
    if (segEval.judgment === "hallucination" && segEval.confidence >= 0.7) {
      const dbSeg = dbSegments[segEval.index];
      if (dbSeg) {
        db.delete(schema.transcriptionSegments)
          .where(eq(schema.transcriptionSegments.id, dbSeg.id))
          .run();
        consola.warn(
          `[evaluator] Removed segment #${segEval.index}: "${dbSeg.transcription?.slice(0, 30)}..." - ${segEval.reason}`,
        );
        removedCount++;
      }
      if (segEval.suggestedPattern) {
        patternsToApply.push({ pattern: segEval.suggestedPattern, reason: segEval.reason });
      }
    }
  }

  if (removedCount > 0) {
    consola.info(
      `[evaluator] Removed ${removedCount}/${segments.length} hallucinated segments for ${basename(filePath)}`,
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
}
