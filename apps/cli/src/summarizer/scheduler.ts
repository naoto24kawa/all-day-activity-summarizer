import type { AdasDatabase, SummaryQueueJob } from "@repo/db";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";
import { generateDailySummary, generateTimesSummary } from "./generator.js";
import {
  cleanupOldJobs,
  dequeue,
  enqueue,
  getQueueStats,
  markCompleted,
  markFailed,
  recoverStaleJobs,
} from "./queue.js";

// Re-export generator functions for backward compatibility
export { generateDailySummary, generateTimesSummary } from "./generator.js";

// ---------------------------------------------------------------------------
// Enqueue Scheduler - 時間境界を検出してジョブを投入
// ---------------------------------------------------------------------------

export function startEnqueueScheduler(db: AdasDatabase, config: AdasConfig): () => void {
  let lastDailyDate = "";
  const dailyScheduleHour = config.summarizer.dailyScheduleHour ?? 23;

  const checkAndEnqueue = () => {
    const now = new Date();
    const date = getTodayDateString();
    const currentHour = now.getHours();

    // Daily: 指定時間以降に1日分をキューに追加 (自動生成は daily のみ)
    if (currentHour >= dailyScheduleHour && lastDailyDate !== date) {
      lastDailyDate = date;
      const job = enqueue(db, {
        jobType: "daily",
        date,
      });
      if (job) {
        consola.info(`Enqueued daily job for ${date}`);
      }
    }
  };

  consola.info(`Daily summary scheduled at ${dailyScheduleHour}:00`);

  // 初回実行
  checkAndEnqueue();

  // 1分毎にチェック
  const interval = setInterval(checkAndEnqueue, 60_000);

  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// Worker - キューからジョブを取り出して処理
// ---------------------------------------------------------------------------

async function processJob(db: AdasDatabase, job: SummaryQueueJob): Promise<void> {
  const { jobType, date } = job;
  // SummaryQueueJob 型に startHour/endHour が追加されているはずだが、
  // drizzle の型推論が追いついていない可能性があるため、any を経由してアクセス
  const jobWithHours = job as SummaryQueueJob & {
    startHour?: number | null;
    endHour?: number | null;
  };
  const { startHour, endHour } = jobWithHours;

  switch (jobType) {
    case "times": {
      if (
        startHour === null ||
        startHour === undefined ||
        endHour === null ||
        endHour === undefined
      ) {
        throw new Error("startHour and endHour are required for times job");
      }
      consola.info(`Processing times summary for ${date} ${startHour}:00 - ${endHour}:59...`);
      const result = await generateTimesSummary(db, date, startHour, endHour);
      if (result) {
        consola.success(`Times summary generated for ${date} ${startHour}:00 - ${endHour}:59`);
      } else {
        consola.debug(`No data for times summary ${date} ${startHour}:00 - ${endHour}:59`);
      }
      break;
    }

    case "daily": {
      consola.info(`Processing daily summary for ${date}...`);
      const result = await generateDailySummary(db, date);
      if (result) {
        consola.success(`Daily summary generated for ${date}`);
      } else {
        consola.debug(`No data found for daily summary ${date}`);
      }
      break;
    }
  }
}

export function startWorker(db: AdasDatabase): () => void {
  let isProcessing = false;

  const processQueue = async () => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      // Stale ジョブの復旧
      const recovered = recoverStaleJobs(db);
      if (recovered > 0) {
        consola.warn(`Recovered ${recovered} stale jobs`);
      }

      // ジョブを処理
      let job = dequeue(db);
      while (job) {
        try {
          await processJob(db, job);
          markCompleted(db, job.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          consola.error(`Job ${job.id} failed:`, message);
          markFailed(db, job.id, message);
        }
        job = dequeue(db);
      }

      // 古いジョブの削除 (1日1回程度で十分だが、毎回でも軽量)
      const cleaned = cleanupOldJobs(db);
      if (cleaned > 0) {
        consola.debug(`Cleaned up ${cleaned} old jobs`);
      }
    } finally {
      isProcessing = false;
    }
  };

  // 初回実行
  processQueue();

  // 10秒毎にチェック
  const interval = setInterval(processQueue, 10_000);

  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// 統合スケジューラー (既存 API 互換)
// ---------------------------------------------------------------------------

export function startScheduler(db: AdasDatabase, config: AdasConfig): () => void {
  consola.info("Starting summary scheduler with queue-based processing");

  const stats = getQueueStats(db);
  consola.debug(`Queue stats: ${JSON.stringify(stats)}`);

  const stopEnqueue = startEnqueueScheduler(db, config);
  const stopWorker = startWorker(db);

  return () => {
    stopEnqueue();
    stopWorker();
  };
}
