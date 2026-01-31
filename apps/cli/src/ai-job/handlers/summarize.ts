/**
 * Summarize Handlers
 *
 * サマリ生成ジョブハンドラー (pomodoro/hourly/daily)
 */

import type { AdasDatabase } from "@repo/db";
import type { AdasConfig } from "../../config.js";
import {
  generateDailySummary,
  generateHourlySummary,
  generatePomodoroSummary,
} from "../../summarizer/scheduler.js";
import type { JobResult } from "../worker.js";

/**
 * Pomodoro サマリ生成
 */
export async function handleSummarizePomodoro(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = params.date as string;
  const startTime = params.startTime as string;
  const endTime = params.endTime as string;

  if (!date || !startTime || !endTime) {
    return {
      success: false,
      resultSummary: "date, startTime, endTime が必要です",
    };
  }

  const result = await generatePomodoroSummary(db, date, startTime, endTime);

  return {
    success: true,
    resultSummary: result ? "Pomodoro サマリを生成しました" : "データがないためスキップしました",
    data: { generated: !!result },
  };
}

/**
 * Hourly サマリ生成
 */
export async function handleSummarizeHourly(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = params.date as string;
  const hour = params.hour as number;

  if (!date || hour === undefined) {
    return {
      success: false,
      resultSummary: "date, hour が必要です",
    };
  }

  const result = await generateHourlySummary(db, date, hour);

  return {
    success: true,
    resultSummary: result
      ? `${hour}時台のサマリを生成しました`
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

  if (!date) {
    return {
      success: false,
      resultSummary: "date が必要です",
    };
  }

  const result = await generateDailySummary(db, date);

  return {
    success: true,
    resultSummary: result ? "日次サマリを生成しました" : "データがないためスキップしました",
    data: { generated: !!result },
  };
}
