/**
 * AI Processing Log Helper
 *
 * Worker ルートから CLI Server にログを送信するヘルパー
 */

import type { AiProcessType, CreateAiProcessingLogRequest } from "@repo/types";
import consola from "consola";

/**
 * CLI Server の URL を環境変数から取得
 * デフォルト: http://localhost:3456
 */
function getCliServerUrl(): string {
  return process.env.ADAS_CLI_SERVER_URL || "http://localhost:3456";
}

/**
 * 現在の日付を YYYY-MM-DD 形式で取得 (JST)
 */
function getTodayDateString(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0] as string;
}

/**
 * AI 処理ログを CLI Server に送信
 */
async function sendProcessingLog(logData: CreateAiProcessingLogRequest): Promise<void> {
  const url = `${getCliServerUrl()}/api/ai-processing-logs`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });

    if (!response.ok) {
      consola.warn(`[log-processing] Failed to send log: ${response.status}`);
    }
  } catch (err) {
    // ログ送信失敗は警告のみ、処理は止めない
    consola.warn(`[log-processing] Failed to send log:`, err instanceof Error ? err.message : err);
  }
}

/**
 * AI 処理をラップしてログを自動記録する
 *
 * @param processType - 処理タイプ
 * @param model - 使用モデル名
 * @param fn - 実行する処理
 * @param getStats - 結果から統計情報を取得する関数 (任意)
 */
export async function withProcessingLog<T>(
  processType: AiProcessType,
  model: string | undefined,
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

/**
 * 処理ログを直接送信する (withProcessingLog を使わない場合)
 */
export function logProcessing(
  processType: AiProcessType,
  status: "success" | "error",
  durationMs: number,
  options?: {
    model?: string;
    inputSize?: number;
    outputSize?: number;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  },
): void {
  sendProcessingLog({
    date: getTodayDateString(),
    processType,
    status,
    model: options?.model,
    inputSize: options?.inputSize,
    outputSize: options?.outputSize,
    durationMs,
    errorMessage: options?.errorMessage,
    metadata: options?.metadata,
  });
}
