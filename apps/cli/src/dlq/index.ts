/**
 * Dead Letter Queue (DLQ) Utilities
 *
 * 最終失敗したジョブを統一管理し、手動再実行を可能にする
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { DLQOriginalQueue, DLQStats, DLQStatus } from "@repo/types";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * ジョブを DLQ に移動
 */
export function moveToDLQ(
  db: AdasDatabase,
  originalQueue: DLQOriginalQueue,
  originalId: number,
  jobType: string,
  params: string | null,
  errorMessage: string,
  retryCount: number,
): number {
  const now = new Date().toISOString();

  const result = db
    .insert(schema.deadLetterQueue)
    .values({
      originalQueue,
      originalId,
      jobType,
      params,
      errorMessage,
      retryCount,
      failedAt: now,
      status: "dead",
      createdAt: now,
    })
    .returning({ id: schema.deadLetterQueue.id })
    .get();

  return result.id;
}

/**
 * DLQ ジョブ一覧を取得
 */
export function listDLQJobs(
  db: AdasDatabase,
  options?: {
    status?: DLQStatus;
    queue?: DLQOriginalQueue;
    limit?: number;
  },
) {
  const { status, queue, limit = 100 } = options ?? {};

  let query = db
    .select()
    .from(schema.deadLetterQueue)
    .orderBy(desc(schema.deadLetterQueue.failedAt))
    .limit(limit);

  const conditions = [];
  if (status) {
    conditions.push(eq(schema.deadLetterQueue.status, status));
  }
  if (queue) {
    conditions.push(eq(schema.deadLetterQueue.originalQueue, queue));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query.all();
}

/**
 * DLQ ジョブを取得
 */
export function getDLQJob(db: AdasDatabase, dlqId: number) {
  return db.select().from(schema.deadLetterQueue).where(eq(schema.deadLetterQueue.id, dlqId)).get();
}

/**
 * DLQ ジョブを再実行済みとしてマーク
 */
export function markDLQRetried(db: AdasDatabase, dlqId: number): void {
  const now = new Date().toISOString();

  db.update(schema.deadLetterQueue)
    .set({
      status: "retried",
      retriedAt: now,
    })
    .where(eq(schema.deadLetterQueue.id, dlqId))
    .run();
}

/**
 * DLQ ジョブを無視としてマーク
 */
export function ignoreDLQJob(db: AdasDatabase, dlqId: number): boolean {
  const result = db
    .update(schema.deadLetterQueue)
    .set({
      status: "ignored",
    })
    .where(eq(schema.deadLetterQueue.id, dlqId))
    .returning({ id: schema.deadLetterQueue.id })
    .get();

  return !!result;
}

/**
 * DLQ 統計を取得
 */
export function getDLQStats(db: AdasDatabase): DLQStats {
  // ステータス別カウント
  const statusStats = db
    .select({
      status: schema.deadLetterQueue.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.deadLetterQueue)
    .groupBy(schema.deadLetterQueue.status)
    .all();

  // キュー別カウント
  const queueStats = db
    .select({
      queue: schema.deadLetterQueue.originalQueue,
      count: sql<number>`count(*)`,
    })
    .from(schema.deadLetterQueue)
    .groupBy(schema.deadLetterQueue.originalQueue)
    .all();

  const result: DLQStats = {
    total: 0,
    dead: 0,
    retried: 0,
    ignored: 0,
    byQueue: {
      ai_job: 0,
      slack: 0,
      github: 0,
      claude_code: 0,
      notion: 0,
      calendar: 0,
      summary: 0,
    },
  };

  for (const row of statusStats) {
    result[row.status as keyof Pick<DLQStats, "dead" | "retried" | "ignored">] = row.count;
    result.total += row.count;
  }

  for (const row of queueStats) {
    result.byQueue[row.queue as DLQOriginalQueue] = row.count;
  }

  return result;
}

/**
 * 古い DLQ エントリをクリーンアップ
 */
export function cleanupOldDLQJobs(db: AdasDatabase, olderThanDays = 30): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const result = db
    .delete(schema.deadLetterQueue)
    .where(
      and(
        sql`${schema.deadLetterQueue.failedAt} < ${cutoff}`,
        eq(schema.deadLetterQueue.status, "ignored"),
      ),
    )
    .returning({ id: schema.deadLetterQueue.id })
    .all();

  return result.length;
}
