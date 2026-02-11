/**
 * Vocabulary Extract Scheduler
 *
 * 用語抽出を定期実行するスケジューラー
 * 毎時30分に各ソースから用語を抽出
 */

import type { AdasDatabase } from "@repo/db";
import consola from "consola";
import { enqueueJob } from "../ai-job/queue.js";
import { getTodayDateString } from "../utils/date.js";

// 定期実行の分 (30分)
// hourly サマリーは 0分に実行されるので、30分にずらす
const SCHEDULED_MINUTE = 30;

// 抽出対象のソースタイプ
const SOURCE_TYPES = ["slack", "github", "claude-code", "memo", "notion"] as const;

/**
 * 用語抽出スケジューラーを開始
 * 毎時30分に実行
 */
export function startVocabularyExtractScheduler(db: AdasDatabase): () => void {
  let lastRunHour = -1;

  const checkAndEnqueue = () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 指定分になったら、かつ今時間でまだ実行していない場合
    if (currentMinute >= SCHEDULED_MINUTE && lastRunHour !== currentHour) {
      lastRunHour = currentHour;
      enqueueVocabularyExtractJobs(db);
    }
  };

  consola.info(
    `[vocabulary] Vocabulary extract scheduler started (runs every hour at :${SCHEDULED_MINUTE})`,
  );

  // 初回チェック
  checkAndEnqueue();

  // 1分毎にチェック
  const interval = setInterval(checkAndEnqueue, 60_000);

  return () => {
    clearInterval(interval);
    consola.info("[vocabulary] Vocabulary extract scheduler stopped");
  };
}

/**
 * 全ソースの用語抽出ジョブをキューに追加
 */
function enqueueVocabularyExtractJobs(db: AdasDatabase): void {
  const date = getTodayDateString();

  consola.info(`[vocabulary] Enqueuing vocabulary extract jobs for ${date}...`);

  let enqueued = 0;
  for (const sourceType of SOURCE_TYPES) {
    try {
      const jobId = enqueueJob(db, "vocabulary-extract", { sourceType, date });
      consola.debug(`[vocabulary] Enqueued ${sourceType} extract job (ID: ${jobId})`);
      enqueued++;
    } catch (err) {
      consola.error(`[vocabulary] Failed to enqueue ${sourceType} extract job:`, err);
    }
  }

  consola.info(`[vocabulary] Enqueued ${enqueued} vocabulary extract jobs`);
}
