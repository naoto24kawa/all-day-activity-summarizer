/**
 * GitHub Worker
 *
 * Processes GitHub jobs from the queue in parallel
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import { enqueueTaskExtractIfEnabled } from "../ai-job/auto-task-extract.js";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";
import { processGitHubJob } from "./fetcher.js";
import {
  cleanupOldGitHubJobs,
  dequeueGitHubJobs,
  markGitHubJobCompleted,
  markGitHubJobFailed,
  recoverStaleGitHubJobs,
} from "./queue.js";

/**
 * Start the GitHub worker
 */
export function startGitHubWorker(db: AdasDatabase, config: AdasConfig): () => void {
  let isProcessing = false;
  const parallelWorkers = config.github.parallelWorkers;

  const processQueue = async () => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      // Recover stale jobs
      const recovered = recoverStaleGitHubJobs(db);
      if (recovered > 0) {
        consola.warn(`[GitHub] Recovered ${recovered} stale jobs`);
      }

      // Process jobs in parallel
      const jobs = dequeueGitHubJobs(db, parallelWorkers);

      if (jobs.length > 0) {
        consola.debug(`[GitHub] Processing ${jobs.length} jobs in parallel`);

        await Promise.all(
          jobs.map(async (job) => {
            try {
              await processGitHubJob(db, job);
              markGitHubJobCompleted(db, job.id);
              enqueueTaskExtractIfEnabled(db, config, "github", {
                date: getTodayDateString(),
              });
              enqueueTaskExtractIfEnabled(db, config, "githubComment", {
                date: getTodayDateString(),
              });
              consola.debug(`[GitHub] Job ${job.id} (${job.jobType}) completed`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              consola.error(`[GitHub] Job ${job.id} failed:`, message);
              markGitHubJobFailed(db, job.id, message);
            }
          }),
        );
      }

      // Cleanup old jobs (lightweight, can run every time)
      const cleaned = cleanupOldGitHubJobs(db);
      if (cleaned > 0) {
        consola.debug(`[GitHub] Cleaned up ${cleaned} old jobs`);
      }
    } finally {
      isProcessing = false;
    }
  };

  // Initial run
  processQueue();

  // Check every 10 seconds
  const interval = setInterval(processQueue, 10_000);

  return () => clearInterval(interval);
}
