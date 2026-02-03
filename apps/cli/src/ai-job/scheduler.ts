/**
 * AI Job Scheduler
 *
 * 10秒ごとにキューをポーリングしてジョブを実行
 */

import type { AdasDatabase } from "@repo/db";
import type { AIJob } from "@repo/types";
import consola from "consola";
import { extractTasksFromAiProcessingLogs } from "../ai-processing-log/task-extractor.js";
import type { AdasConfig } from "../config.js";
import { cleanupOldUsage } from "../utils/rate-limiter.js";
import { getSSENotifier } from "../utils/sse-notifier.js";
import { registerAllHandlers } from "./handlers/index.js";
import { cleanupOldJobs, getJob } from "./queue.js";
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
 * ジョブ完了を通知 (リスナー + SSE)
 */
async function notifyJobCompleted(
  db: AdasDatabase,
  jobId: number,
  jobType: string,
  resultSummary: string | null,
): Promise<void> {
  // レガシーリスナーへの通知
  for (const listener of completedListeners) {
    try {
      listener(jobId, jobType, resultSummary);
    } catch (err) {
      consola.error("[ai-job] Listener error:", err);
    }
  }

  // SSE 経由で通知
  const notifier = getSSENotifier();
  if (notifier) {
    try {
      const job = getJob(db, jobId);
      if (job) {
        await notifier.emitJobCompleted(job as AIJob);
        // バッジも更新 (タスク抽出などで変わる可能性)
        await notifier.emitBadgesUpdated(db);
      }
    } catch (err) {
      consola.debug("[ai-job] SSE notify error:", err);
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
          void notifyJobCompleted(db, result.jobId, result.jobType, result.resultSummary ?? null);
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
      const deletedJobs = cleanupOldJobs(db);
      if (deletedJobs > 0) {
        consola.info(`[ai-job] Cleaned up ${deletedJobs} old jobs`);
      }

      const deletedUsage = cleanupOldUsage(db);
      if (deletedUsage > 0) {
        consola.info(`[ai-job] Cleaned up ${deletedUsage} old rate limit usage records`);
      }
    } catch (err) {
      consola.error("[ai-job] Cleanup error:", err);
    }
  }, CLEANUP_INTERVAL_MS);

  // AI Processing Log からのタスク抽出タイマー
  let aiLogExtractInterval: ReturnType<typeof setInterval> | null = null;
  const aiLogExtractConfig = config.aiProcessingLogExtract;

  if (aiLogExtractConfig.enabled && aiLogExtractConfig.intervalMinutes > 0) {
    const intervalMs = aiLogExtractConfig.intervalMinutes * 60 * 1000;
    aiLogExtractInterval = setInterval(() => {
      try {
        const result = extractTasksFromAiProcessingLogs(db, {});
        if (result.extracted > 0) {
          consola.info(
            `[ai-job] Extracted ${result.extracted} tasks from AI processing logs (${result.processed} processed, ${result.skipped} skipped)`,
          );
        }
      } catch (err) {
        consola.error("[ai-job] AI log extract error:", err);
      }
    }, intervalMs);
    consola.info(
      `[ai-job] AI Processing Log extract enabled (every ${aiLogExtractConfig.intervalMinutes} min)`,
    );
  }

  // 初回クリーンアップを実行
  try {
    const deletedJobs = cleanupOldJobs(db);
    if (deletedJobs > 0) {
      consola.info(`[ai-job] Initial cleanup: ${deletedJobs} old jobs deleted`);
    }

    const deletedUsage = cleanupOldUsage(db);
    if (deletedUsage > 0) {
      consola.info(
        `[ai-job] Initial cleanup: ${deletedUsage} old rate limit usage records deleted`,
      );
    }
  } catch (err) {
    consola.error("[ai-job] Initial cleanup error:", err);
  }

  consola.success("[ai-job] AI Job scheduler started (polling every 10s)");

  // 停止関数
  return () => {
    clearInterval(pollInterval);
    clearInterval(cleanupInterval);
    if (aiLogExtractInterval) {
      clearInterval(aiLogExtractInterval);
    }
    consola.info("[ai-job] AI Job scheduler stopped");
  };
}
