/**
 * Slack Job Queue Management
 */

import type { AdasDatabase, SlackQueueJob } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

export type SlackJobType = "fetch_mentions" | "fetch_channel" | "fetch_dm";

export interface EnqueueSlackJobOptions {
  jobType: SlackJobType;
  channelId?: string; // Required for fetch_channel and fetch_dm
  runAfter?: string; // ISO8601 timestamp, defaults to now
  lastFetchedTs?: string; // For pagination
}

/**
 * Add a job to the Slack queue
 * Skips if identical pending/processing job exists
 */
export function enqueueSlackJob(
  db: AdasDatabase,
  options: EnqueueSlackJobOptions,
): SlackQueueJob | null {
  const { jobType, channelId, runAfter = new Date().toISOString(), lastFetchedTs } = options;
  const now = new Date().toISOString();

  // Check for duplicate pending/processing job
  const existing = db
    .select()
    .from(schema.slackQueue)
    .where(
      and(
        eq(schema.slackQueue.jobType, jobType),
        channelId
          ? eq(schema.slackQueue.channelId, channelId)
          : sql`${schema.slackQueue.channelId} IS NULL`,
        inArray(schema.slackQueue.status, ["pending", "processing"]),
      ),
    )
    .get();

  if (existing) {
    return null; // Already exists, skip
  }

  const result = db
    .insert(schema.slackQueue)
    .values({
      jobType,
      channelId,
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
      runAfter,
      lastFetchedTs,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return result;
}

/**
 * Dequeue multiple jobs for parallel processing
 */
export function dequeueSlackJobs(db: AdasDatabase, limit: number): SlackQueueJob[] {
  const now = new Date().toISOString();

  // Get pending jobs that are ready to run
  const jobs = db
    .select()
    .from(schema.slackQueue)
    .where(and(eq(schema.slackQueue.status, "pending"), lte(schema.slackQueue.runAfter, now)))
    .orderBy(schema.slackQueue.runAfter)
    .limit(limit)
    .all();

  if (jobs.length === 0) {
    return [];
  }

  // Lock all jobs atomically
  const lockedJobs: SlackQueueJob[] = [];
  for (const job of jobs) {
    const updated = db
      .update(schema.slackQueue)
      .set({
        status: "processing",
        lockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.slackQueue.id, job.id),
          eq(schema.slackQueue.status, "pending"), // Optimistic lock
        ),
      )
      .returning()
      .get();

    if (updated) {
      lockedJobs.push(updated);
    }
  }

  return lockedJobs;
}

/**
 * Mark job as completed
 */
export function markSlackJobCompleted(
  db: AdasDatabase,
  jobId: number,
  lastFetchedTs?: string,
): void {
  const now = new Date().toISOString();

  db.update(schema.slackQueue)
    .set({
      status: "completed",
      lastFetchedTs: lastFetchedTs ?? undefined,
      updatedAt: now,
    })
    .where(eq(schema.slackQueue.id, jobId))
    .run();
}

/**
 * Mark job as failed with retry logic
 * Exponential Backoff: 30s * 2^retryCount
 */
export function markSlackJobFailed(db: AdasDatabase, jobId: number, errorMessage: string): void {
  const now = new Date().toISOString();

  const job = db.select().from(schema.slackQueue).where(eq(schema.slackQueue.id, jobId)).get();

  if (!job) {
    return;
  }

  const newRetryCount = job.retryCount + 1;

  if (newRetryCount < job.maxRetries) {
    // Retry with exponential backoff
    const delayMs = 30_000 * 2 ** job.retryCount; // 30s, 60s, 120s, ...
    const runAfter = new Date(Date.now() + delayMs).toISOString();

    db.update(schema.slackQueue)
      .set({
        status: "pending",
        retryCount: newRetryCount,
        errorMessage,
        lockedAt: null,
        runAfter,
        updatedAt: now,
      })
      .where(eq(schema.slackQueue.id, jobId))
      .run();
  } else {
    // Final failure
    db.update(schema.slackQueue)
      .set({
        status: "failed",
        retryCount: newRetryCount,
        errorMessage,
        updatedAt: now,
      })
      .where(eq(schema.slackQueue.id, jobId))
      .run();
  }
}

/**
 * Clean up old completed/failed jobs
 */
export function cleanupOldSlackJobs(db: AdasDatabase, retentionDays = 7): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(schema.slackQueue)
    .where(
      and(
        lt(schema.slackQueue.updatedAt, cutoff),
        or(eq(schema.slackQueue.status, "completed"), eq(schema.slackQueue.status, "failed")),
      ),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * Recover stale processing jobs
 */
export function recoverStaleSlackJobs(db: AdasDatabase, timeoutMinutes = 10): number {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const result = db
    .update(schema.slackQueue)
    .set({
      status: "pending",
      lockedAt: null,
      updatedAt: now,
    })
    .where(and(eq(schema.slackQueue.status, "processing"), lt(schema.slackQueue.lockedAt, cutoff)))
    .returning()
    .all();

  return result.length;
}

/**
 * Get queue statistics
 */
export function getSlackQueueStats(db: AdasDatabase): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
} {
  const jobs = db.select().from(schema.slackQueue).all();

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const job of jobs) {
    stats[job.status]++;
  }

  return stats;
}
