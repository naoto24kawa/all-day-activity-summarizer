/**
 * Notion Worker
 *
 * Notion ジョブを並列処理
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import { enqueueTaskExtractIfEnabled } from "../ai-job/auto-task-extract.js";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";
import type { NotionClient } from "./client.js";
import { processNotionJob } from "./fetcher.js";
import {
  cleanupOldNotionJobs,
  dequeueNotionJobs,
  enqueueNotionJob,
  markNotionJobCompleted,
  markNotionJobFailed,
  recoverStaleNotionJobs,
} from "./queue.js";

/**
 * Notion Worker を開始
 */
export function startNotionWorker(
  db: AdasDatabase,
  config: AdasConfig,
  client: NotionClient,
): () => void {
  let isProcessing = false;
  const parallelWorkers = config.notion.parallelWorkers;

  const processQueue = async () => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      // スタックしたジョブを回復
      const recovered = recoverStaleNotionJobs(db);
      if (recovered > 0) {
        consola.warn(`[Notion] Recovered ${recovered} stale jobs`);
      }

      // ジョブを並列処理
      const jobs = dequeueNotionJobs(db, parallelWorkers);

      if (jobs.length > 0) {
        consola.debug(`[Notion] Processing ${jobs.length} jobs in parallel`);

        await Promise.all(
          jobs.map(async (job) => {
            try {
              const result = await processNotionJob(db, client, job);
              markNotionJobCompleted(db, job.id, result.nextCursor);
              if (job.jobType === "fetch_page_content") {
                enqueueTaskExtractIfEnabled(db, config, "notion", {
                  date: getTodayDateString(),
                });
              }
              consola.debug(
                `[Notion] Job ${job.id} (${job.jobType}) completed: ${result.saved} saved`,
              );

              // ページネーション継続: nextCursor がある場合はフォローアップジョブを作成
              if (result.nextCursor) {
                enqueueNotionJob(db, {
                  jobType: job.jobType as "fetch_recent_pages" | "fetch_database_items",
                  databaseId: job.databaseId ?? undefined,
                  cursor: result.nextCursor,
                  skipDuplicateCheck: true,
                });
                consola.debug(
                  `[Notion] Enqueued follow-up job for ${job.jobType} (cursor: ${result.nextCursor.slice(0, 8)}...)`,
                );
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              consola.error(`[Notion] Job ${job.id} failed:`, message);
              markNotionJobFailed(db, job.id, message);
            }
          }),
        );
      }

      // 古いジョブをクリーンアップ
      const cleaned = cleanupOldNotionJobs(db);
      if (cleaned > 0) {
        consola.debug(`[Notion] Cleaned up ${cleaned} old jobs`);
      }
    } finally {
      isProcessing = false;
    }
  };

  // 初回実行
  processQueue();

  // 10秒ごとにチェック
  const interval = setInterval(processQueue, 10_000);

  return () => clearInterval(interval);
}
