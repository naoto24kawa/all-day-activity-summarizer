/**
 * Calendar Worker
 *
 * Processes Calendar jobs from the queue
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import type { GoogleCalendarClient } from "./client.js";
import { fetchCalendarEvents } from "./fetcher.js";
import {
  cleanupOldCalendarJobs,
  dequeueCalendarJob,
  markCalendarJobCompleted,
  markCalendarJobFailed,
  recoverStaleCalendarJobs,
} from "./queue.js";

/**
 * Start the Calendar worker
 */
export function startCalendarWorker(
  db: AdasDatabase,
  config: AdasConfig,
  client: GoogleCalendarClient,
): () => void {
  let isProcessing = false;
  const daysToFetch = config.calendar.daysToFetch;

  const processQueue = async () => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      // Recover stale jobs
      const recovered = recoverStaleCalendarJobs(db);
      if (recovered > 0) {
        consola.warn(`[Calendar] Recovered ${recovered} stale jobs`);
      }

      // Process one job at a time (Calendar API has lower rate limits)
      const job = dequeueCalendarJob(db);

      if (job) {
        consola.debug(`[Calendar] Processing job ${job.id} (${job.jobType})`);

        try {
          if (job.jobType === "fetch_events") {
            const now = new Date();
            const timeMin = new Date(now.getTime() - daysToFetch * 24 * 60 * 60 * 1000);
            const timeMax = new Date(now.getTime() + daysToFetch * 24 * 60 * 60 * 1000);

            // カレンダーIDが指定されていない場合はプライマリ
            const calendarId = job.calendarId || "primary";

            await fetchCalendarEvents(db, client, calendarId, timeMin, timeMax);
            markCalendarJobCompleted(db, job.id);
            consola.debug(`[Calendar] Job ${job.id} (${job.jobType}) completed`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          consola.error(`[Calendar] Job ${job.id} failed:`, message);
          markCalendarJobFailed(db, job.id, message);
        }
      }

      // Cleanup old jobs (lightweight, can run every time)
      const cleaned = cleanupOldCalendarJobs(db);
      if (cleaned > 0) {
        consola.debug(`[Calendar] Cleaned up ${cleaned} old jobs`);
      }
    } finally {
      isProcessing = false;
    }
  };

  // Initial run
  processQueue();

  // Check every 30 seconds (Calendar API has stricter rate limits)
  const interval = setInterval(processQueue, 30_000);

  return () => clearInterval(interval);
}
