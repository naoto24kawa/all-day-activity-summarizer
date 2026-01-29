/**
 * GitHub Scheduler
 *
 * Periodically enqueues GitHub fetch jobs
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { checkAuth, getCurrentUser } from "./client.js";
import { enqueueGitHubJob, getGitHubQueueStats } from "./queue.js";
import { startGitHubWorker } from "./worker.js";

/**
 * Start the GitHub scheduler
 */
export function startGitHubEnqueueScheduler(db: AdasDatabase, config: AdasConfig): () => void {
  const intervalMs = config.github.fetchIntervalMinutes * 60 * 1000;

  const enqueueJobs = () => {
    // Enqueue issues fetch
    const issuesJob = enqueueGitHubJob(db, {
      jobType: "fetch_issues",
    });
    if (issuesJob) {
      consola.debug("[GitHub] Enqueued issues fetch job");
    }

    // Enqueue PRs fetch
    const prsJob = enqueueGitHubJob(db, {
      jobType: "fetch_prs",
    });
    if (prsJob) {
      consola.debug("[GitHub] Enqueued PRs fetch job");
    }

    // Enqueue review requests fetch
    const reviewRequestsJob = enqueueGitHubJob(db, {
      jobType: "fetch_review_requests",
    });
    if (reviewRequestsJob) {
      consola.debug("[GitHub] Enqueued review requests fetch job");
    }
  };

  // Initial enqueue
  enqueueJobs();

  // Periodic enqueue
  const interval = setInterval(enqueueJobs, intervalMs);

  consola.info(`[GitHub] Scheduler started (interval: ${config.github.fetchIntervalMinutes}min)`);

  return () => clearInterval(interval);
}

/**
 * Initialize and start the complete GitHub system
 */
export async function startGitHubSystem(
  db: AdasDatabase,
  config: AdasConfig,
): Promise<(() => void) | null> {
  if (!config.github.enabled) {
    consola.debug("[GitHub] Disabled in config");
    return null;
  }

  // Check authentication
  const auth = await checkAuth();
  if (!auth.authenticated) {
    consola.warn("[GitHub] Not authenticated. Run 'gh auth login' first.");
    return null;
  }

  const username = auth.username || (await getCurrentUser());
  consola.success(`[GitHub] Authenticated as ${username}`);

  // Log queue stats
  const stats = getGitHubQueueStats(db);
  consola.debug(`[GitHub] Queue stats: ${JSON.stringify(stats)}`);

  // Start scheduler and worker
  const stopScheduler = startGitHubEnqueueScheduler(db, config);
  const stopWorker = startGitHubWorker(db, config);

  consola.success("[GitHub] System started");

  return () => {
    stopScheduler();
    stopWorker();
    consola.info("[GitHub] System stopped");
  };
}
