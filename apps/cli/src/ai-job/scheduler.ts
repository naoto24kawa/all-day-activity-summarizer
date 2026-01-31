/**
 * AI Job Scheduler
 *
 * 10秒ごとにキューをポーリングしてジョブを実行
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { registerAllHandlers } from "./handlers/index.js";
import { cleanupOldJobs } from "./queue.js";
import { processJob } from "./worker.js";

const POLL_INTERVAL_MS = 10 * 1000; // 10秒
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24時間

/** ジョブ完了リスナー型 */
export type JobCompletedListener = (
  jobId: number,
  jobType: string,
  resultSummary: string | null,
) => void;

/** グローバルリスナーリスト */
const completedListeners: JobCompletedListener[] = [];

/**
 * ジョブ完了リスナーを追加
 */
export function addJobCompletedListener(listener: JobCompletedListener): () => void {
  completedListeners.push(listener);
  return () => {
    const index = completedListeners.indexOf(listener);
    if (index >= 0) {
      completedListeners.splice(index, 1);
    }
  };
}

/**
 * ジョブ完了を通知
 */
function notifyJobCompleted(jobId: number, jobType: string, resultSummary: string | null): void {
  for (const listener of completedListeners) {
    try {
      listener(jobId, jobType, resultSummary);
    } catch (err) {
      consola.error("[ai-job] Listener error:", err);
    }
  }
}

/**
 * スケジューラーを開始
 */
export function startAIJobScheduler(db: AdasDatabase, config: AdasConfig): () => void {
  // ハンドラーを登録
  registerAllHandlers();

  consola.info("[ai-job] Starting AI Job scheduler");

  let isProcessing = false;

  // ポーリングループ
  const pollInterval = setInterval(async () => {
    if (isProcessing) return;

    isProcessing = true;
    try {
      // 1回のポーリングで複数ジョブを処理
      let processedCount = 0;
      const maxJobsPerPoll = 5;

      while (processedCount < maxJobsPerPoll) {
        const result = await processJob(db, config);

        if (!result.processed) break;

        // 完了/失敗を通知
        if (result.jobId && result.jobType) {
          notifyJobCompleted(result.jobId, result.jobType, result.resultSummary ?? null);
        }

        processedCount++;
      }
    } catch (err) {
      consola.error("[ai-job] Poll error:", err);
    } finally {
      isProcessing = false;
    }
  }, POLL_INTERVAL_MS);

  // クリーンアップタイマー
  const cleanupInterval = setInterval(() => {
    try {
      const deleted = cleanupOldJobs(db);
      if (deleted > 0) {
        consola.info(`[ai-job] Cleaned up ${deleted} old jobs`);
      }
    } catch (err) {
      consola.error("[ai-job] Cleanup error:", err);
    }
  }, CLEANUP_INTERVAL_MS);

  // 初回クリーンアップを実行
  try {
    const deleted = cleanupOldJobs(db);
    if (deleted > 0) {
      consola.info(`[ai-job] Initial cleanup: ${deleted} old jobs deleted`);
    }
  } catch (err) {
    consola.error("[ai-job] Initial cleanup error:", err);
  }

  consola.success("[ai-job] AI Job scheduler started (polling every 10s)");

  // 停止関数
  return () => {
    clearInterval(pollInterval);
    clearInterval(cleanupInterval);
    consola.info("[ai-job] AI Job scheduler stopped");
  };
}
