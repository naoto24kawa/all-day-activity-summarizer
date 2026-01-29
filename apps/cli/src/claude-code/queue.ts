/**
 * Claude Code Job Queue Management
 */

import type { AdasDatabase, ClaudeCodeQueueJob } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

export type ClaudeCodeJobType = "fetch_sessions";

export interface EnqueueClaudeCodeJobOptions {
  jobType: ClaudeCodeJobType;
  projectPath?: string; // null = all projects
  runAfter?: string; // ISO8601 timestamp, defaults to now
}

/**
 * Add a job to the Claude Code queue
 * Skips if identical pending/processing job exists
 */
export function enqueueClaudeCodeJob(
  db: AdasDatabase,
  options: EnqueueClaudeCodeJobOptions,
): ClaudeCodeQueueJob | null {
  const { jobType, projectPath, runAfter = new Date().toISOString() } = options;
  const now = new Date().toISOString();

  // Check for duplicate pending/processing job
  const existing = db
    .select()
    .from(schema.claudeCodeQueue)
    .where(
      and(
        eq(schema.claudeCodeQueue.jobType, jobType),
        projectPath
          ? eq(schema.claudeCodeQueue.projectPath, projectPath)
          : sql`${schema.claudeCodeQueue.projectPath} IS NULL`,
        inArray(schema.claudeCodeQueue.status, ["pending", "processing"]),
      ),
    )
    .get();

  if (existing) {
    return null; // Already exists, skip
  }

  const result = db
    .insert(schema.claudeCodeQueue)
    .values({
      jobType,
      projectPath,
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
export function dequeueClaudeCodeJobs(db: AdasDatabase, limit: number): ClaudeCodeQueueJob[] {
  const now = new Date().toISOString();

  // Get pending jobs that are ready to run
  const jobs = db
    .select()
    .from(schema.claudeCodeQueue)
    .where(
      and(eq(schema.claudeCodeQueue.status, "pending"), lte(schema.claudeCodeQueue.runAfter, now)),
    )
    .orderBy(schema.claudeCodeQueue.runAfter)
    .limit(limit)
    .all();

  if (jobs.length === 0) {
    return [];
  }

  // Lock all jobs atomically
  const lockedJobs: ClaudeCodeQueueJob[] = [];
  for (const job of jobs) {
    const updated = db
      .update(schema.claudeCodeQueue)
      .set({
        status: "processing",
        lockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.claudeCodeQueue.id, job.id),
          eq(schema.claudeCodeQueue.status, "pending"), // Optimistic lock
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
export function markClaudeCodeJobCompleted(db: AdasDatabase, jobId: number): void {
  const now = new Date().toISOString();

  db.update(schema.claudeCodeQueue)
    .set({
      status: "completed",
      updatedAt: now,
    })
    .where(eq(schema.claudeCodeQueue.id, jobId))
    .run();
}

/**
 * Mark job as failed with retry logic
 * Exponential Backoff: 30s * 2^retryCount
 */
export function markClaudeCodeJobFailed(
  db: AdasDatabase,
  jobId: number,
  errorMessage: string,
): void {
  const now = new Date().toISOString();

  const job = db
    .select()
    .from(schema.claudeCodeQueue)
    .where(eq(schema.claudeCodeQueue.id, jobId))
    .get();

  if (!job) {
    return;
  }

  const newRetryCount = job.retryCount + 1;

  if (newRetryCount < job.maxRetries) {
    // Retry with exponential backoff
    const delayMs = 30_000 * 2 ** job.retryCount; // 30s, 60s, 120s, ...
    const runAfter = new Date(Date.now() + delayMs).toISOString();

    db.update(schema.claudeCodeQueue)
      .set({
        status: "pending",
        retryCount: newRetryCount,
        errorMessage,
        lockedAt: null,
        runAfter,
        updatedAt: now,
      })
      .where(eq(schema.claudeCodeQueue.id, jobId))
      .run();
  } else {
    // Final failure
    db.update(schema.claudeCodeQueue)
      .set({
        status: "failed",
        retryCount: newRetryCount,
        errorMessage,
        updatedAt: now,
      })
      .where(eq(schema.claudeCodeQueue.id, jobId))
      .run();
  }
}

/**
 * Clean up old completed/failed jobs
 */
export function cleanupOldClaudeCodeJobs(db: AdasDatabase, retentionDays = 7): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(schema.claudeCodeQueue)
    .where(
      and(
        lt(schema.claudeCodeQueue.updatedAt, cutoff),
        or(
          eq(schema.claudeCodeQueue.status, "completed"),
          eq(schema.claudeCodeQueue.status, "failed"),
        ),
      ),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * Recover stale processing jobs
 */
export function recoverStaleClaudeCodeJobs(db: AdasDatabase, timeoutMinutes = 10): number {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const result = db
    .update(schema.claudeCodeQueue)
    .set({
      status: "pending",
      lockedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.claudeCodeQueue.status, "processing"),
        lt(schema.claudeCodeQueue.lockedAt, cutoff),
      ),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * Get queue statistics
 */
export function getClaudeCodeQueueStats(db: AdasDatabase): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
} {
  const jobs = db.select().from(schema.claudeCodeQueue).all();

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const job of jobs) {
    stats[job.status]++;
  }

  return stats;
}
