/**
 * GitHub Job Queue Management
 */

import type { AdasDatabase, GitHubQueueJob } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq, inArray, lt, lte, or } from "drizzle-orm";
import { moveToDLQ } from "../dlq/index.js";

export type GitHubJobType = "fetch_issues" | "fetch_prs" | "fetch_review_requests";

export interface EnqueueGitHubJobOptions {
  jobType: GitHubJobType;
  runAfter?: string; // ISO8601 timestamp, defaults to now
}

/**
 * Add a job to the GitHub queue
 * Skips if identical pending/processing job exists
 */
export function enqueueGitHubJob(
  db: AdasDatabase,
  options: EnqueueGitHubJobOptions,
): GitHubQueueJob | null {
  const { jobType, runAfter = new Date().toISOString() } = options;
  const now = new Date().toISOString();

  // Check for duplicate pending/processing job
  const existing = db
    .select()
    .from(schema.githubQueue)
    .where(
      and(
        eq(schema.githubQueue.jobType, jobType),
        inArray(schema.githubQueue.status, ["pending", "processing"]),
      ),
    )
    .get();

  if (existing) {
    return null; // Already exists, skip
  }

  const result = db
    .insert(schema.githubQueue)
    .values({
      jobType,
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
      runAfter,
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
export function dequeueGitHubJobs(db: AdasDatabase, limit: number): GitHubQueueJob[] {
  const now = new Date().toISOString();

  // Get pending jobs that are ready to run
  const jobs = db
    .select()
    .from(schema.githubQueue)
    .where(and(eq(schema.githubQueue.status, "pending"), lte(schema.githubQueue.runAfter, now)))
    .orderBy(schema.githubQueue.runAfter)
    .limit(limit)
    .all();

  if (jobs.length === 0) {
    return [];
  }

  // Lock all jobs atomically
  const lockedJobs: GitHubQueueJob[] = [];
  for (const job of jobs) {
    const updated = db
      .update(schema.githubQueue)
      .set({
        status: "processing",
        lockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.githubQueue.id, job.id),
          eq(schema.githubQueue.status, "pending"), // Optimistic lock
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
export function markGitHubJobCompleted(db: AdasDatabase, jobId: number): void {
  const now = new Date().toISOString();

  db.update(schema.githubQueue)
    .set({
      status: "completed",
      updatedAt: now,
    })
    .where(eq(schema.githubQueue.id, jobId))
    .run();
}

/**
 * Mark job as failed with retry logic
 * Exponential Backoff: 30s * 2^retryCount
 */
export function markGitHubJobFailed(db: AdasDatabase, jobId: number, errorMessage: string): void {
  const now = new Date().toISOString();

  const job = db.select().from(schema.githubQueue).where(eq(schema.githubQueue.id, jobId)).get();

  if (!job) {
    return;
  }

  const newRetryCount = job.retryCount + 1;

  if (newRetryCount < job.maxRetries) {
    // Retry with exponential backoff
    const delayMs = 30_000 * 2 ** job.retryCount; // 30s, 60s, 120s, ...
    const runAfter = new Date(Date.now() + delayMs).toISOString();

    db.update(schema.githubQueue)
      .set({
        status: "pending",
        retryCount: newRetryCount,
        errorMessage,
        lockedAt: null,
        runAfter,
        updatedAt: now,
      })
      .where(eq(schema.githubQueue.id, jobId))
      .run();
  } else {
    // Final failure
    db.update(schema.githubQueue)
      .set({
        status: "failed",
        retryCount: newRetryCount,
        errorMessage,
        updatedAt: now,
      })
      .where(eq(schema.githubQueue.id, jobId))
      .run();

    // DLQ に移動
    moveToDLQ(db, "github", jobId, job.jobType, null, errorMessage, newRetryCount);
  }
}

/**
 * Clean up old completed/failed jobs
 */
export function cleanupOldGitHubJobs(db: AdasDatabase, retentionDays = 7): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(schema.githubQueue)
    .where(
      and(
        lt(schema.githubQueue.updatedAt, cutoff),
        or(eq(schema.githubQueue.status, "completed"), eq(schema.githubQueue.status, "failed")),
      ),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * Recover stale processing jobs
 */
export function recoverStaleGitHubJobs(db: AdasDatabase, timeoutMinutes = 10): number {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const result = db
    .update(schema.githubQueue)
    .set({
      status: "pending",
      lockedAt: null,
      updatedAt: now,
    })
    .where(
      and(eq(schema.githubQueue.status, "processing"), lt(schema.githubQueue.lockedAt, cutoff)),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * Get queue statistics
 */
export function getGitHubQueueStats(db: AdasDatabase): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
} {
  const jobs = db.select().from(schema.githubQueue).all();

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const job of jobs) {
    stats[job.status]++;
  }

  return stats;
}
