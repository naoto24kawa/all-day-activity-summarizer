/**
 * Slack Worker
 *
 * Processes Slack jobs from the queue in parallel
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import type { SlackClient } from "./client.js";
import { processSlackJob } from "./fetcher.js";
import {
  cleanupOldSlackJobs,
  dequeueSlackJobs,
  markSlackJobCompleted,
  markSlackJobFailed,
  recoverStaleSlackJobs,
} from "./queue.js";

/**
 * Start the Slack worker
 */
export function startSlackWorker(
  db: AdasDatabase,
  config: AdasConfig,
  client: SlackClient,
  currentUserId: string,
): () => void {
  let isProcessing = false;
  const parallelWorkers = config.slack.parallelWorkers;
  const mentionGroups = config.slack.mentionGroups || [];
  const watchKeywords = config.slack.watchKeywords || [];

  const processQueue = async () => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      // Recover stale jobs
      const recovered = recoverStaleSlackJobs(db);
      if (recovered > 0) {
        consola.warn(`[Slack] Recovered ${recovered} stale jobs`);
      }

      // Process jobs in parallel
      const jobs = dequeueSlackJobs(db, parallelWorkers);

      if (jobs.length > 0) {
        consola.debug(`[Slack] Processing ${jobs.length} jobs in parallel`);

        await Promise.all(
          jobs.map(async (job) => {
            try {
              const lastTs = await processSlackJob(
                db,
                client,
                job,
                currentUserId,
                mentionGroups,
                watchKeywords,
              );
              markSlackJobCompleted(db, job.id, lastTs);
              consola.debug(`[Slack] Job ${job.id} (${job.jobType}) completed`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              consola.error(`[Slack] Job ${job.id} failed:`, message);
              markSlackJobFailed(db, job.id, message);
            }
          }),
        );
      }

      // Cleanup old jobs (lightweight, can run every time)
      const cleaned = cleanupOldSlackJobs(db);
      if (cleaned > 0) {
        consola.debug(`[Slack] Cleaned up ${cleaned} old jobs`);
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
