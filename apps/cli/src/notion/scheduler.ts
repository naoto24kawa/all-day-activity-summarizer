/**
 * Notion Scheduler
 *
 * 定期的に Notion 取得ジョブをキューに追加
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { createNotionClient } from "./client.js";
import { enqueueNotionJob, getNotionQueueStats } from "./queue.js";
import { startNotionWorker } from "./worker.js";

/**
 * Notion ジョブをキューに追加するスケジューラーを開始
 */
export function startNotionEnqueueScheduler(
  db: AdasDatabase,
  config: AdasConfig,
  databaseIds: string[],
): () => void {
  const intervalMs = config.notion.fetchIntervalMinutes * 60 * 1000;

  const enqueueJobs = () => {
    // 最近のページ取得ジョブを追加
    const recentPagesJob = enqueueNotionJob(db, {
      jobType: "fetch_recent_pages",
    });
    if (recentPagesJob) {
      consola.debug("[Notion] Enqueued fetch_recent_pages job");
    }

    // 各データベースの取得ジョブを追加
    for (const databaseId of databaseIds) {
      const dbJob = enqueueNotionJob(db, {
        jobType: "fetch_database_items",
        databaseId,
      });
      if (dbJob) {
        consola.debug(`[Notion] Enqueued fetch_database_items job for ${databaseId}`);
      }
    }
  };

  // 初回キュー追加
  enqueueJobs();

  // 定期的にキュー追加
  const interval = setInterval(enqueueJobs, intervalMs);

  consola.info(
    `[Notion] Scheduler started (interval: ${config.notion.fetchIntervalMinutes}min, databases: ${databaseIds.length})`,
  );

  return () => clearInterval(interval);
}

/**
 * Notion システム全体を開始
 */
export async function startNotionSystem(
  db: AdasDatabase,
  config: AdasConfig,
): Promise<(() => void) | null> {
  if (!config.notion.enabled) {
    consola.debug("[Notion] Disabled in config");
    return null;
  }

  const client = createNotionClient(config.notion);
  if (!client) {
    consola.warn("[Notion] Missing token in config");
    return null;
  }

  // 認証テスト
  try {
    const me = await client.users.me({});
    consola.success(`[Notion] Authenticated as ${me.name ?? me.id}`);
  } catch (error) {
    consola.error("[Notion] Authentication failed:", error);
    return null;
  }

  const databaseIds = config.notion.databaseIds;

  // キュー統計をログ
  const stats = getNotionQueueStats(db);
  consola.debug(`[Notion] Queue stats: ${JSON.stringify(stats)}`);

  // スケジューラーと Worker を開始
  const stopScheduler = startNotionEnqueueScheduler(db, config, databaseIds);
  const stopWorker = startNotionWorker(db, config, client);

  consola.success("[Notion] System started");

  return () => {
    stopScheduler();
    stopWorker();
    consola.info("[Notion] System stopped");
  };
}
