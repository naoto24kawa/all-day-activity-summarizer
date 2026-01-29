/**
 * Claude Code Worker
 *
 * Processes Claude Code jobs from the queue in parallel
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import type { ClaudeCodeClient } from "./client.js";
import { processClaudeCodeJob } from "./fetcher.js";
import {
  cleanupOldClaudeCodeJobs,
  dequeueClaudeCodeJobs,
  markClaudeCodeJobCompleted,
  markClaudeCodeJobFailed,
  recoverStaleClaudeCodeJobs,
} from "./queue.js";

/**
 * Start the Claude Code worker
 */
export function startClaudeCodeWorker(
  db: AdasDatabase,
  config: AdasConfig,
  client: ClaudeCodeClient,
): () => void {
  let isProcessing = false;
  const parallelWorkers = config.claudeCode.parallelWorkers;
  const filterProjects = config.claudeCode.projects;

  const processQueue = async () => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      // Recover stale jobs
      const recovered = recoverStaleClaudeCodeJobs(db);
      if (recovered > 0) {
        consola.warn(`[ClaudeCode] Recovered ${recovered} stale jobs`);
      }

      // Process jobs in parallel
      const jobs = dequeueClaudeCodeJobs(db, parallelWorkers);

      if (jobs.length > 0) {
        consola.debug(`[ClaudeCode] Processing ${jobs.length} jobs in parallel`);

        await Promise.all(
          jobs.map(async (job) => {
            try {
              await processClaudeCodeJob(db, client, job, filterProjects);
              markClaudeCodeJobCompleted(db, job.id);
              consola.debug(`[ClaudeCode] Job ${job.id} (${job.jobType}) completed`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              consola.error(`[ClaudeCode] Job ${job.id} failed:`, message);
              markClaudeCodeJobFailed(db, job.id, message);
            }
          }),
        );
      }

      // Cleanup old jobs (lightweight, can run every time)
      const cleaned = cleanupOldClaudeCodeJobs(db);
      if (cleaned > 0) {
        consola.debug(`[ClaudeCode] Cleaned up ${cleaned} old jobs`);
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
