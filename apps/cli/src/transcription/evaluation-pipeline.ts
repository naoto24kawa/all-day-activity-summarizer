import { basename, resolve } from "node:path";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../config.js";
import { applyNewPattern, evaluateTranscription } from "../whisper/evaluator.js";

/** ハルシネーションと判定する信頼度の閾値 */
export const HALLUCINATION_CONFIDENCE_THRESHOLD = 0.7;

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

/**
 * Claude SDK による非同期ハルシネーション評価を実行する。
 *
 * @param text - 全体のテキスト
 * @param segments - セグメント配列
 * @param filePath - 音声ファイルパス
 * @param config - ADAS設定
 * @param db - データベース接続
 * @returns ハルシネーションと判定されたセグメントの index 配列 (削除済み)
 */
export async function runAsyncEvaluation(
  text: string,
  segments: TranscriptionSegment[],
  filePath: string,
  config: AdasConfig,
  db: AdasDatabase,
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
    if (
      evaluation.judgment === "hallucination" &&
      evaluation.confidence >= HALLUCINATION_CONFIDENCE_THRESHOLD
    ) {
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
    if (
      segEval.judgment === "hallucination" &&
      segEval.confidence >= HALLUCINATION_CONFIDENCE_THRESHOLD
    ) {
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
