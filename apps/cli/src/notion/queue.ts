/**
 * Notion Queue
 *
 * Notion 取得ジョブのキュー管理
 */

import type { AdasDatabase } from "@repo/db";
import { notionQueue } from "@repo/db/schema";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

interface EnqueueOptions {
  jobType: "fetch_recent_pages" | "fetch_database_items";
  databaseId?: string;
  cursor?: string;
  runAfter?: Date;
}

/**
 * ジョブをキューに追加
 * 同じジョブタイプ+databaseId の pending/processing ジョブがある場合はスキップ
 */
export function enqueueNotionJob(db: AdasDatabase, options: EnqueueOptions) {
  const { jobType, databaseId, cursor, runAfter } = options;

  // 既存の pending/processing ジョブをチェック
  const existing = db
    .select({ id: notionQueue.id })
    .from(notionQueue)
    .where(
      and(
        eq(notionQueue.jobType, jobType),
        databaseId ? eq(notionQueue.databaseId, databaseId) : isNull(notionQueue.databaseId),
        or(eq(notionQueue.status, "pending"), eq(notionQueue.status, "processing")),
      ),
    )
    .get();

  if (existing) {
    return null;
  }

  const now = new Date().toISOString();
  const result = db
    .insert(notionQueue)
    .values({
      jobType,
      databaseId: databaseId ?? null,
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
      runAfter: runAfter?.toISOString() ?? now,
      cursor: cursor ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return result;
}

/**
 * 実行可能なジョブを取得してロック
 */
export function dequeueNotionJobs(db: AdasDatabase, limit: number) {
  const now = new Date().toISOString();
  const lockTimeout = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5分前

  // 実行可能なジョブを取得
  const jobs = db
    .select()
    .from(notionQueue)
    .where(
      and(
        eq(notionQueue.status, "pending"),
        lt(notionQueue.runAfter, now),
        or(isNull(notionQueue.lockedAt), lt(notionQueue.lockedAt, lockTimeout)),
      ),
    )
    .limit(limit)
    .all();

  // ロックを取得
  for (const job of jobs) {
    db.update(notionQueue)
      .set({
        status: "processing",
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(notionQueue.id, job.id))
      .run();
  }

  return jobs;
}

/**
 * ジョブを完了としてマーク
 */
export function markNotionJobCompleted(db: AdasDatabase, jobId: number, nextCursor?: string) {
  const now = new Date().toISOString();

  db.update(notionQueue)
    .set({
      status: "completed",
      cursor: nextCursor ?? null,
      updatedAt: now,
    })
    .where(eq(notionQueue.id, jobId))
    .run();
}

/**
 * ジョブを失敗としてマーク (リトライ可能な場合は pending に戻す)
 */
export function markNotionJobFailed(db: AdasDatabase, jobId: number, errorMessage: string) {
  const job = db.select().from(notionQueue).where(eq(notionQueue.id, jobId)).get();

  if (!job) return;

  const now = new Date().toISOString();

  if (job.retryCount < job.maxRetries) {
    // リトライ: 指数バックオフで遅延
    const delayMs = Math.min(1000 * 2 ** job.retryCount, 60000);
    const runAfter = new Date(Date.now() + delayMs).toISOString();

    db.update(notionQueue)
      .set({
        status: "pending",
        retryCount: job.retryCount + 1,
        errorMessage,
        lockedAt: null,
        runAfter,
        updatedAt: now,
      })
      .where(eq(notionQueue.id, jobId))
      .run();
  } else {
    // リトライ上限: 失敗としてマーク
    db.update(notionQueue)
      .set({
        status: "failed",
        errorMessage,
        updatedAt: now,
      })
      .where(eq(notionQueue.id, jobId))
      .run();
  }
}

/**
 * 古いジョブをクリーンアップ
 */
export function cleanupOldNotionJobs(db: AdasDatabase, olderThanDays = 7): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(notionQueue)
    .where(
      and(
        or(eq(notionQueue.status, "completed"), eq(notionQueue.status, "failed")),
        lt(notionQueue.updatedAt, cutoff),
      ),
    )
    .run();

  return result.changes;
}

/**
 * スタックしたジョブを回復
 */
export function recoverStaleNotionJobs(db: AdasDatabase, staleMinutes = 10): number {
  const staleTime = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const result = db
    .update(notionQueue)
    .set({
      status: "pending",
      lockedAt: null,
      updatedAt: now,
    })
    .where(and(eq(notionQueue.status, "processing"), lt(notionQueue.lockedAt, staleTime)))
    .run();

  return result.changes;
}

/**
 * キュー統計を取得
 */
export function getNotionQueueStats(db: AdasDatabase) {
  const stats = db
    .select({
      status: notionQueue.status,
      count: sql<number>`count(*)`,
    })
    .from(notionQueue)
    .groupBy(notionQueue.status)
    .all();

  const result = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  for (const row of stats) {
    if (row.status in result) {
      result[row.status as keyof typeof result] = row.count;
    }
  }

  return result;
}
