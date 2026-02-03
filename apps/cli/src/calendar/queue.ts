/**
 * Calendar Job Queue Management
 */

import type { AdasDatabase, CalendarQueueJob } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

export type CalendarJobType = "fetch_events";

export interface EnqueueCalendarJobOptions {
  jobType: CalendarJobType;
  calendarId?: string; // 対象カレンダーID (null = 全カレンダー)
  runAfter?: string; // ISO8601 timestamp, defaults to now
  pageToken?: string; // ページネーション用
}

/**
 * Add a job to the Calendar queue
 * Skips if identical pending/processing job exists
 */
export function enqueueCalendarJob(
  db: AdasDatabase,
  options: EnqueueCalendarJobOptions,
): CalendarQueueJob | null {
  const { jobType, calendarId, runAfter = new Date().toISOString(), pageToken } = options;
  const now = new Date().toISOString();

  // Check for duplicate pending/processing job
  const existing = db
    .select()
    .from(schema.calendarQueue)
    .where(
      and(
        eq(schema.calendarQueue.jobType, jobType),
        calendarId
          ? eq(schema.calendarQueue.calendarId, calendarId)
          : sql`${schema.calendarQueue.calendarId} IS NULL`,
        inArray(schema.calendarQueue.status, ["pending", "processing"]),
      ),
    )
    .get();

  if (existing) {
    return null; // Already exists, skip
  }

  const result = db
    .insert(schema.calendarQueue)
    .values({
      jobType,
      calendarId,
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
      runAfter,
      pageToken,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return result;
}

/**
 * Dequeue a job for processing
 */
export function dequeueCalendarJob(db: AdasDatabase): CalendarQueueJob | null {
  const now = new Date().toISOString();

  // Get pending job that is ready to run
  const job = db
    .select()
    .from(schema.calendarQueue)
    .where(and(eq(schema.calendarQueue.status, "pending"), lte(schema.calendarQueue.runAfter, now)))
    .orderBy(schema.calendarQueue.runAfter)
    .limit(1)
    .get();

  if (!job) {
    return null;
  }

  // Lock the job
  const updated = db
    .update(schema.calendarQueue)
    .set({
      status: "processing",
      lockedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.calendarQueue.id, job.id),
        eq(schema.calendarQueue.status, "pending"), // Optimistic lock
      ),
    )
    .returning()
    .get();

  return updated || null;
}

/**
 * Mark job as completed
 */
export function markCalendarJobCompleted(db: AdasDatabase, jobId: number): void {
  const now = new Date().toISOString();

  db.update(schema.calendarQueue)
    .set({
      status: "completed",
      updatedAt: now,
    })
    .where(eq(schema.calendarQueue.id, jobId))
    .run();
}

/**
 * Mark job as failed with retry logic
 * Exponential Backoff: 30s * 2^retryCount
 */
export function markCalendarJobFailed(db: AdasDatabase, jobId: number, errorMessage: string): void {
  const now = new Date().toISOString();

  const job = db
    .select()
    .from(schema.calendarQueue)
    .where(eq(schema.calendarQueue.id, jobId))
    .get();

  if (!job) {
    return;
  }

  const newRetryCount = job.retryCount + 1;

  if (newRetryCount < job.maxRetries) {
    // Retry with exponential backoff
    const delayMs = 30_000 * 2 ** job.retryCount; // 30s, 60s, 120s, ...
    const runAfter = new Date(Date.now() + delayMs).toISOString();

    db.update(schema.calendarQueue)
      .set({
        status: "pending",
        retryCount: newRetryCount,
        errorMessage,
        lockedAt: null,
        runAfter,
        updatedAt: now,
      })
      .where(eq(schema.calendarQueue.id, jobId))
      .run();
  } else {
    // Final failure
    db.update(schema.calendarQueue)
      .set({
        status: "failed",
        retryCount: newRetryCount,
        errorMessage,
        updatedAt: now,
      })
      .where(eq(schema.calendarQueue.id, jobId))
      .run();
  }
}

/**
 * Clean up old completed/failed jobs
 */
export function cleanupOldCalendarJobs(db: AdasDatabase, retentionDays = 7): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(schema.calendarQueue)
    .where(
      and(
        lt(schema.calendarQueue.updatedAt, cutoff),
        or(eq(schema.calendarQueue.status, "completed"), eq(schema.calendarQueue.status, "failed")),
      ),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * Recover stale processing jobs
 */
export function recoverStaleCalendarJobs(db: AdasDatabase, timeoutMinutes = 10): number {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const result = db
    .update(schema.calendarQueue)
    .set({
      status: "pending",
      lockedAt: null,
      updatedAt: now,
    })
    .where(
      and(eq(schema.calendarQueue.status, "processing"), lt(schema.calendarQueue.lockedAt, cutoff)),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * Get queue statistics
 */
export function getCalendarQueueStats(db: AdasDatabase): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
} {
  const jobs = db.select().from(schema.calendarQueue).all();

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const job of jobs) {
    stats[job.status]++;
  }

  return stats;
}
