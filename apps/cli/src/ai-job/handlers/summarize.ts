/**
 * Summarize Handlers
 *
 * サマリ生成ジョブハンドラー (times/daily)
 */

import type { AdasDatabase } from "@repo/db";
import type { AdasConfig } from "../../config.js";
import { generateDailySummary, generateTimesSummary } from "../../summarizer/scheduler.js";
import type { JobResult } from "../worker.js";

/**
 * Times サマリ生成 (ユーザー指定の時間範囲)
 */
export async function handleSummarizeTimes(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = params.date as string;
  const startHour = params.startHour as number;
  const endHour = params.endHour as number;

  if (!date || startHour === undefined || endHour === undefined) {
    return {
      success: false,
      resultSummary: "date, startHour, endHour が必要です",
    };
  }

  const result = await generateTimesSummary(db, date, startHour, endHour);

  return {
    success: true,
    resultSummary: result
      ? `${startHour}時〜${endHour}時のサマリを生成しました`
      : "データがないためスキップしました",
    data: { generated: !!result },
  };
}

/**
 * Daily サマリ生成
 */
export async function handleSummarizeDaily(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = params.date as string;
  const overwrite = params.overwrite as boolean | undefined;

  if (!date) {
    return {
      success: false,
      resultSummary: "date が必要です",
    };
  }

  const result = await generateDailySummary(db, date, { overwrite: overwrite ?? false });

  return {
    success: true,
    resultSummary: result ? "日次サマリを生成しました" : "データがないためスキップしました",
    data: { generated: !!result },
  };
}
