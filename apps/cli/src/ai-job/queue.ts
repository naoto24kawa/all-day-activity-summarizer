/**
 * AI Job Queue
 *
 * AIジョブのキュー管理 (enqueue/dequeue/mark*)
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { AIJobStatus, AIJobType } from "@repo/types";
import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { getTodayDateString } from "../utils/date.js";

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5分

/**
 * ジョブをキューに追加
 */
export function enqueueJob(
  db: AdasDatabase,
  jobType: AIJobType,
  params?: Record<string, unknown>,
  runAfter?: string,
): number {
  const now = new Date().toISOString();
  const result = db
    .insert(schema.aiJobQueue)
    .values({
      jobType,
      params: params ? JSON.stringify(params) : null,
      status: "pending",
      runAfter: runAfter ?? now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.aiJobQueue.id })
    .get();

  return result.id;
}

/**
 * 実行可能なジョブを1件取得してロック
 */
export function dequeueJob(db: AdasDatabase) {
  const now = new Date().toISOString();
  const lockExpiredAt = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();

  // pending または lockedAt がタイムアウトしている processing を取得
  const job = db
    .select()
    .from(schema.aiJobQueue)
    .where(
      and(
        lte(schema.aiJobQueue.runAfter, now),
        or(
          eq(schema.aiJobQueue.status, "pending"),
          and(
            eq(schema.aiJobQueue.status, "processing"),
            lte(schema.aiJobQueue.lockedAt, lockExpiredAt),
          ),
        ),
      ),
    )
    .orderBy(schema.aiJobQueue.runAfter)
    .limit(1)
    .get();

  if (!job) {
    return null;
  }

  // ロックを取得
  db.update(schema.aiJobQueue)
    .set({
      status: "processing",
      lockedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.aiJobQueue.id, job.id))
    .run();

  return { ...job, status: "processing" as AIJobStatus, lockedAt: now };
}

/**
 * ジョブを完了としてマーク
 */
export function markJobCompleted(
  db: AdasDatabase,
  jobId: number,
  result: unknown,
  resultSummary: string,
): void {
  const now = new Date().toISOString();
  db.update(schema.aiJobQueue)
    .set({
      status: "completed",
      result: JSON.stringify(result),
      resultSummary,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.aiJobQueue.id, jobId))
    .run();
}

/**
 * ジョブを失敗としてマーク
 */
export function markJobFailed(db: AdasDatabase, jobId: number, errorMessage: string): void {
  const now = new Date().toISOString();

  // 現在のジョブを取得
  const job = db.select().from(schema.aiJobQueue).where(eq(schema.aiJobQueue.id, jobId)).get();

  if (!job) return;

  const newRetryCount = job.retryCount + 1;
  const shouldRetry = newRetryCount < job.maxRetries;

  if (shouldRetry) {
    // リトライ: 指数バックオフで再スケジュール
    const backoffMs = Math.min(1000 * 2 ** newRetryCount, 60000);
    const runAfter = new Date(Date.now() + backoffMs).toISOString();

    db.update(schema.aiJobQueue)
      .set({
        status: "pending",
        retryCount: newRetryCount,
        errorMessage,
        lockedAt: null,
        runAfter,
        updatedAt: now,
      })
      .where(eq(schema.aiJobQueue.id, jobId))
      .run();
  } else {
    // 最終失敗
    db.update(schema.aiJobQueue)
      .set({
        status: "failed",
        retryCount: newRetryCount,
        errorMessage,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.aiJobQueue.id, jobId))
      .run();
  }
}

/**
 * ジョブを取得
 */
export function getJob(db: AdasDatabase, jobId: number) {
  return db.select().from(schema.aiJobQueue).where(eq(schema.aiJobQueue.id, jobId)).get();
}

/**
 * ジョブ一覧を取得
 */
export function listJobs(
  db: AdasDatabase,
  options?: {
    status?: AIJobStatus;
    limit?: number;
  },
) {
  const { status, limit = 100 } = options ?? {};

  let query = db
    .select()
    .from(schema.aiJobQueue)
    .orderBy(desc(schema.aiJobQueue.createdAt))
    .limit(limit);

  if (status) {
    query = query.where(eq(schema.aiJobQueue.status, status)) as typeof query;
  }

  return query.all();
}

/**
 * ジョブ統計を取得 (当日のみ)
 */
export function getJobStats(db: AdasDatabase) {
  const today = getTodayDateString();

  const stats = db
    .select({
      status: schema.aiJobQueue.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.aiJobQueue)
    .where(gte(schema.aiJobQueue.createdAt, today))
    .groupBy(schema.aiJobQueue.status)
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

/**
 * 完了済み/失敗済みジョブをクリーンアップ
 */
export function cleanupOldJobs(db: AdasDatabase, olderThanDays = 7): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(schema.aiJobQueue)
    .where(
      and(
        or(eq(schema.aiJobQueue.status, "completed"), eq(schema.aiJobQueue.status, "failed")),
        lte(schema.aiJobQueue.completedAt, cutoff),
      ),
    )
    .returning({ id: schema.aiJobQueue.id })
    .all();

  return result.length;
}
