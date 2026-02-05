/**
 * Notion Worker
 *
 * Notion ジョブを並列処理
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import type { NotionClient } from "./client.js";
import { processNotionJob } from "./fetcher.js";
import {
  cleanupOldNotionJobs,
  dequeueNotionJobs,
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
              consola.debug(
                `[Notion] Job ${job.id} (${job.jobType}) completed: ${result.saved} saved`,
              );
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
