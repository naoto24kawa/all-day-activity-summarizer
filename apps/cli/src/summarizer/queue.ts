import type { AdasDatabase, SummaryQueueJob } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { moveToDLQ } from "../dlq/index.js";

export type JobType = "times" | "daily";

export interface EnqueueOptions {
  jobType: JobType;
  date: string;
  startHour?: number; // times 用: 開始時間 (0-23)
  endHour?: number; // times 用: 終了時間 (0-23)
  runAfter?: string; // ISO8601 timestamp, defaults to now
}

/**
 * ジョブをキューに追加する
 * 同じ (jobType, date, startHour, endHour) で pending/processing のジョブが既にある場合は無視
 */
export function enqueue(db: AdasDatabase, options: EnqueueOptions): SummaryQueueJob | null {
  const { jobType, date, startHour, endHour, runAfter = new Date().toISOString() } = options;
  const now = new Date().toISOString();

  // 重複チェック: 同じジョブが pending または processing で存在するか
  const existing = db
    .select()
    .from(schema.summaryQueue)
    .where(
      and(
        eq(schema.summaryQueue.jobType, jobType),
        eq(schema.summaryQueue.date, date),
        startHour !== undefined
          ? eq(schema.summaryQueue.startHour, startHour)
          : sql`${schema.summaryQueue.startHour} IS NULL`,
        endHour !== undefined
          ? eq(schema.summaryQueue.endHour, endHour)
          : sql`${schema.summaryQueue.endHour} IS NULL`,
        inArray(schema.summaryQueue.status, ["pending", "processing"]),
      ),
    )
    .get();

  if (existing) {
    return null; // 既に存在するのでスキップ
  }

  const result = db
    .insert(schema.summaryQueue)
    .values({
      jobType,
      date,
      startHour,
      endHour,
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
 * 実行可能なジョブを1件取得して processing 状態にする
 * - status が pending
 * - runAfter が現在時刻以前
 */
export function dequeue(db: AdasDatabase): SummaryQueueJob | null {
  const now = new Date().toISOString();

  // pending で runAfter が過ぎているジョブを取得
  const job = db
    .select()
    .from(schema.summaryQueue)
    .where(and(eq(schema.summaryQueue.status, "pending"), lte(schema.summaryQueue.runAfter, now)))
    .orderBy(schema.summaryQueue.runAfter)
    .limit(1)
    .get();

  if (!job) {
    return null;
  }

  // processing に更新
  const updated = db
    .update(schema.summaryQueue)
    .set({
      status: "processing",
      lockedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.summaryQueue.id, job.id),
        eq(schema.summaryQueue.status, "pending"), // 楽観的ロック
      ),
    )
    .returning()
    .get();

  return updated ?? null;
}

/**
 * ジョブを完了状態にする
 */
export function markCompleted(db: AdasDatabase, jobId: number): void {
  const now = new Date().toISOString();

  db.update(schema.summaryQueue)
    .set({
      status: "completed",
      updatedAt: now,
    })
    .where(eq(schema.summaryQueue.id, jobId))
    .run();
}

/**
 * ジョブを失敗状態にする
 * リトライ回数が maxRetries 未満なら pending に戻して再試行
 * Exponential Backoff: 30s * 2^retryCount
 */
export function markFailed(db: AdasDatabase, jobId: number, errorMessage: string): void {
  const now = new Date().toISOString();

  const job = db.select().from(schema.summaryQueue).where(eq(schema.summaryQueue.id, jobId)).get();

  if (!job) {
    return;
  }

  const newRetryCount = job.retryCount + 1;

  if (newRetryCount < job.maxRetries) {
    // リトライ: Exponential Backoff
    const delayMs = 30_000 * 2 ** job.retryCount; // 30s, 60s, 120s, ...
    const runAfter = new Date(Date.now() + delayMs).toISOString();

    db.update(schema.summaryQueue)
      .set({
        status: "pending",
        retryCount: newRetryCount,
        errorMessage,
        lockedAt: null,
        runAfter,
        updatedAt: now,
      })
      .where(eq(schema.summaryQueue.id, jobId))
      .run();
  } else {
    // 最終失敗
    db.update(schema.summaryQueue)
      .set({
        status: "failed",
        retryCount: newRetryCount,
        errorMessage,
        updatedAt: now,
      })
      .where(eq(schema.summaryQueue.id, jobId))
      .run();

    // DLQ に移動
    const params = JSON.stringify({
      date: job.date,
      startHour: job.startHour,
      endHour: job.endHour,
    });
    moveToDLQ(db, "summary", jobId, job.jobType, params, errorMessage, newRetryCount);
  }
}

/**
 * 古いジョブを削除する
 * @param retentionDays 保持日数 (デフォルト: 7日)
 */
export function cleanupOldJobs(db: AdasDatabase, retentionDays = 7): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(schema.summaryQueue)
    .where(
      and(
        lt(schema.summaryQueue.updatedAt, cutoff),
        or(eq(schema.summaryQueue.status, "completed"), eq(schema.summaryQueue.status, "failed")),
      ),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * 長時間 processing のままのジョブを pending に戻す
 * @param timeoutMinutes タイムアウト時間 (デフォルト: 10分)
 */
export function recoverStaleJobs(db: AdasDatabase, timeoutMinutes = 10): number {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const result = db
    .update(schema.summaryQueue)
    .set({
      status: "pending",
      lockedAt: null,
      updatedAt: now,
    })
    .where(
      and(eq(schema.summaryQueue.status, "processing"), lt(schema.summaryQueue.lockedAt, cutoff)),
    )
    .returning()
    .all();

  return result.length;
}

/**
 * キューの状態を取得 (デバッグ用)
 */
export function getQueueStats(db: AdasDatabase): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
} {
  const jobs = db.select().from(schema.summaryQueue).all();

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const job of jobs) {
    stats[job.status]++;
  }

  return stats;
}
