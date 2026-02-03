/**
 * Calendar Scheduler
 *
 * Periodically enqueues Calendar fetch jobs
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { createCalendarClient } from "./client.js";
import { enqueueCalendarJob, getCalendarQueueStats } from "./queue.js";
import { startCalendarWorker } from "./worker.js";

/**
 * Start the Calendar enqueue scheduler
 */
export function startCalendarEnqueueScheduler(
  db: AdasDatabase,
  config: AdasConfig,
  calendarIds: string[],
): () => void {
  const intervalMs = config.calendar.fetchIntervalMinutes * 60 * 1000;

  const enqueueJobs = () => {
    // カレンダーIDが空の場合はプライマリのみ
    const targetCalendarIds = calendarIds.length > 0 ? calendarIds : ["primary"];

    for (const calendarId of targetCalendarIds) {
      const job = enqueueCalendarJob(db, {
        jobType: "fetch_events",
        calendarId,
      });
      if (job) {
        consola.debug(`[Calendar] Enqueued fetch job for ${calendarId}`);
      }
    }
  };

  // Initial enqueue
  enqueueJobs();

  // Periodic enqueue
  const interval = setInterval(enqueueJobs, intervalMs);

  consola.info(
    `[Calendar] Scheduler started (interval: ${config.calendar.fetchIntervalMinutes}min, calendars: ${calendarIds.length || 1})`,
  );

  return () => clearInterval(interval);
}

/**
 * Initialize and start the complete Calendar system
 */
export async function startCalendarSystem(
  db: AdasDatabase,
  config: AdasConfig,
): Promise<(() => void) | null> {
  if (!config.calendar.enabled) {
    consola.debug("[Calendar] Disabled in config");
    return null;
  }

  // Create client
  const client = createCalendarClient(config);

  // Verify authentication
  try {
    const isValid = await client.verifyToken();
    if (!isValid) {
      consola.warn("[Calendar] Token verification failed. Please re-authenticate.");
      return null;
    }
    consola.success("[Calendar] Authenticated successfully");
  } catch (error) {
    if (error instanceof Error && error.message.includes("credentials not found")) {
      consola.warn(
        `[Calendar] ${error.message}\n` +
          "  Download credentials.json from Google Cloud Console:\n" +
          "  1. Go to https://console.cloud.google.com/apis/credentials\n" +
          "  2. Create OAuth 2.0 Client ID (Desktop Application)\n" +
          "  3. Download JSON and save to: " +
          config.calendar.credentialsPath,
      );
    } else {
      consola.error("[Calendar] Authentication failed:", error);
    }
    return null;
  }

  // Get calendar list for logging
  const calendarIds = config.calendar.calendarIds;
  if (calendarIds.length === 0) {
    consola.info("[Calendar] Using primary calendar only");
  } else {
    consola.info(`[Calendar] Monitoring ${calendarIds.length} calendars`);
  }

  // Log queue stats
  const stats = getCalendarQueueStats(db);
  consola.debug(`[Calendar] Queue stats: ${JSON.stringify(stats)}`);

  // Start scheduler and worker
  const stopScheduler = startCalendarEnqueueScheduler(db, config, calendarIds);
  const stopWorker = startCalendarWorker(db, config, client);

  consola.success("[Calendar] System started");

  return () => {
    stopScheduler();
    stopWorker();
    consola.info("[Calendar] System stopped");
  };
}
