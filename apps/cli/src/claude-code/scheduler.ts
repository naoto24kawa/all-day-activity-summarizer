/**
 * Claude Code Scheduler
 *
 * Periodically enqueues Claude Code fetch jobs
 * Starts with 2-minute delay to avoid conflicts with Slack scheduler
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { createClaudeCodeClient } from "./client.js";
import { enqueueClaudeCodeJob, getClaudeCodeQueueStats } from "./queue.js";
import { startClaudeCodeWorker } from "./worker.js";

const STARTUP_DELAY_MS = 2 * 60 * 1000; // 2 minutes delay to avoid Slack scheduler conflicts

/**
 * Start the Claude Code enqueue scheduler
 */
export function startClaudeCodeEnqueueScheduler(db: AdasDatabase, config: AdasConfig): () => void {
  const intervalMs = config.claudeCode.fetchIntervalMinutes * 60 * 1000;

  const enqueueJobs = () => {
    // Enqueue a global fetch_sessions job (fetches all projects)
    const job = enqueueClaudeCodeJob(db, {
      jobType: "fetch_sessions",
    });
    if (job) {
      consola.debug("[ClaudeCode] Enqueued fetch_sessions job");
    }
  };

  // Start after delay to avoid conflicts with other schedulers
  const startupTimeout = setTimeout(() => {
    // Initial enqueue
    enqueueJobs();

    // Periodic enqueue
    const interval = setInterval(enqueueJobs, intervalMs);

    consola.info(
      `[ClaudeCode] Scheduler started (interval: ${config.claudeCode.fetchIntervalMinutes}min, projects: ${config.claudeCode.projects.length || "all"})`,
    );

    // Store interval for cleanup
    (startupTimeout as unknown as { intervalRef: NodeJS.Timeout }).intervalRef = interval;
  }, STARTUP_DELAY_MS);

  consola.info(`[ClaudeCode] Scheduler will start in ${STARTUP_DELAY_MS / 1000}s`);

  return () => {
    clearTimeout(startupTimeout);
    const intervalRef = (startupTimeout as unknown as { intervalRef?: NodeJS.Timeout }).intervalRef;
    if (intervalRef) {
      clearInterval(intervalRef);
    }
  };
}

/**
 * Initialize and start the complete Claude Code system
 */
export async function startClaudeCodeSystem(
  db: AdasDatabase,
  config: AdasConfig,
): Promise<(() => void) | null> {
  if (!config.claudeCode.enabled) {
    consola.debug("[ClaudeCode] Disabled in config");
    return null;
  }

  const client = createClaudeCodeClient();

  // Test connection
  try {
    await client.connect();
    const projects = await client.listProjects();
    consola.success(`[ClaudeCode] Connected, found ${projects.length} projects`);
  } catch (error) {
    consola.error("[ClaudeCode] Failed to connect:", error);
    return null;
  }

  // Log queue stats
  const stats = getClaudeCodeQueueStats(db);
  consola.debug(`[ClaudeCode] Queue stats: ${JSON.stringify(stats)}`);

  // Start scheduler and worker
  const stopScheduler = startClaudeCodeEnqueueScheduler(db, config);
  const stopWorker = startClaudeCodeWorker(db, config, client);

  consola.success("[ClaudeCode] System started");

  return async () => {
    stopScheduler();
    stopWorker();
    await client.disconnect();
    consola.info("[ClaudeCode] System stopped");
  };
}
