/**
 * AI Processing Log Helper (CLI側)
 *
 * CLI から直接 AI を呼び出した場合のログ記録
 */

import type { AiProcessType, CreateAiProcessingLogRequest } from "@repo/types";
import consola from "consola";
import { getTodayDateString } from "./date.js";

/**
 * AI 処理ログを DB に記録 (API 経由)
 */
async function sendProcessingLog(logData: CreateAiProcessingLogRequest): Promise<void> {
  const url = "http://localhost:3001/api/ai-processing-logs";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });

    if (!response.ok) {
      consola.warn(`[ai-log] Failed to send log: ${response.status}`);
    }
  } catch (err) {
    consola.warn(`[ai-log] Failed to send log:`, err instanceof Error ? err.message : err);
  }
}

/**
 * AI 処理をラップしてログを自動記録する
 */
export async function withProcessingLog<T>(
  processType: AiProcessType,
  model: string,
  fn: () => Promise<T>,
  getStats?: (result: T) => {
    inputSize?: number;
    outputSize?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<T> {
  const startTime = performance.now();

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - startTime);

    const stats = getStats?.(result);

    // 非同期でログ送信 (await しない)
    sendProcessingLog({
      date: getTodayDateString(),
      processType,
      status: "success",
      model,
      inputSize: stats?.inputSize,
      outputSize: stats?.outputSize,
      durationMs,
      metadata: stats?.metadata,
    });

    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);

    // 非同期でログ送信 (await しない)
    sendProcessingLog({
      date: getTodayDateString(),
      processType,
      status: "error",
      model,
      durationMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}
