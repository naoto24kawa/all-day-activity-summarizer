/**
 * Slack Scheduler
 *
 * Periodically enqueues Slack fetch jobs
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { createSlackClient } from "./client.js";
import { enqueueSlackJob, getSlackQueueStats } from "./queue.js";
import { startSlackWorker } from "./worker.js";

/**
 * Start the Slack scheduler
 */
export function startSlackEnqueueScheduler(db: AdasDatabase, config: AdasConfig): () => void {
  const intervalMs = config.slack.fetchIntervalMinutes * 60 * 1000;

  const enqueueJobs = () => {
    // Always enqueue mentions fetch
    const mentionsJob = enqueueSlackJob(db, {
      jobType: "fetch_mentions",
    });
    if (mentionsJob) {
      consola.debug("[Slack] Enqueued mentions fetch job");
    }

    // Enqueue channel fetch jobs for configured channels
    for (const channelId of config.slack.channels) {
      const channelJob = enqueueSlackJob(db, {
        jobType: "fetch_channel",
        channelId,
      });
      if (channelJob) {
        consola.debug(`[Slack] Enqueued channel fetch job for ${channelId}`);
      }
    }
  };

  // Initial enqueue
  enqueueJobs();

  // Periodic enqueue
  const interval = setInterval(enqueueJobs, intervalMs);

  consola.info(
    `[Slack] Scheduler started (interval: ${config.slack.fetchIntervalMinutes}min, channels: ${config.slack.channels.length})`,
  );

  return () => clearInterval(interval);
}

/**
 * Initialize and start the complete Slack system
 */
export async function startSlackSystem(
  db: AdasDatabase,
  config: AdasConfig,
): Promise<(() => void) | null> {
  if (!config.slack.enabled) {
    consola.debug("[Slack] Disabled in config");
    return null;
  }

  const client = createSlackClient(config.slack);
  if (!client) {
    consola.warn("[Slack] Missing xoxcToken or xoxdToken in config");
    return null;
  }

  // Test authentication and get current user ID
  let currentUserId: string;
  try {
    const auth = await client.testAuth();
    if (!auth.user_id) {
      throw new Error("Failed to get user ID from auth.test");
    }
    currentUserId = auth.user_id;
    consola.success(`[Slack] Authenticated as ${auth.user} (${auth.team})`);
  } catch (error) {
    consola.error("[Slack] Authentication failed:", error);
    return null;
  }

  // Log queue stats
  const stats = getSlackQueueStats(db);
  consola.debug(`[Slack] Queue stats: ${JSON.stringify(stats)}`);

  // Start scheduler and worker
  const stopScheduler = startSlackEnqueueScheduler(db, config);
  const stopWorker = startSlackWorker(db, config, client, currentUserId);

  consola.success("[Slack] System started");

  return () => {
    stopScheduler();
    stopWorker();
    consola.info("[Slack] System stopped");
  };
}
