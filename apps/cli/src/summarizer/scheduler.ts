import type { AdasDatabase, SummaryQueueJob } from "@repo/db";
import consola from "consola";
import { getTodayDateString } from "../utils/date.js";
import {
  generateDailySummary,
  generateHourlySummary,
  generatePomodoroSummary,
  periodToTimeRange,
} from "./generator.js";
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
export {
  generateDailySummary,
  generateHourlySummary,
  generatePomodoroSummary,
} from "./generator.js";

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/** 30分間隔の period index (0-47) を返す */
function getCurrentPeriodIndex(now: Date): number {
  return now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Enqueue Scheduler - 時間境界を検出してジョブを投入
// ---------------------------------------------------------------------------

export function startEnqueueScheduler(db: AdasDatabase): () => void {
  let lastPomodoroPeriod = -1;
  let lastHourlyHour = -1;
  let lastDailyDate = "";

  const checkAndEnqueue = () => {
    const now = new Date();
    const date = getTodayDateString();
    const currentPeriod = getCurrentPeriodIndex(now);
    const currentHour = now.getHours();

    // Pomodoro: 30分の境界を越えたら前の period をキューに追加
    if (currentPeriod !== lastPomodoroPeriod && currentPeriod > 0) {
      lastPomodoroPeriod = currentPeriod;
      const job = enqueue(db, {
        jobType: "pomodoro",
        date,
        periodParam: currentPeriod - 1,
      });
      if (job) {
        consola.info(`Enqueued pomodoro job for period ${currentPeriod - 1}`);
      }
    }

    // Hourly: 時間の境界を越えたら前の1時間をキューに追加
    if (currentHour !== lastHourlyHour && currentHour > 0) {
      lastHourlyHour = currentHour;
      const job = enqueue(db, {
        jobType: "hourly",
        date,
        periodParam: currentHour - 1,
      });
      if (job) {
        consola.info(`Enqueued hourly job for hour ${currentHour - 1}`);
      }
    }

    // Daily: 23:00以降に1日分をキューに追加
    if (currentHour >= 23 && lastDailyDate !== date) {
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
  const { jobType, date, periodParam } = job;

  switch (jobType) {
    case "pomodoro": {
      if (periodParam === null) {
        throw new Error("periodParam is required for pomodoro job");
      }
      const { startTime, endTime } = periodToTimeRange(date, periodParam);
      consola.info(`Processing pomodoro summary for ${startTime} - ${endTime}...`);
      const result = await generatePomodoroSummary(db, date, startTime, endTime);
      if (result) {
        consola.success(`Pomodoro summary generated for ${startTime} - ${endTime}`);
      } else {
        consola.debug(`No data for pomodoro summary ${startTime} - ${endTime}`);
      }
      break;
    }

    case "hourly": {
      if (periodParam === null) {
        throw new Error("periodParam is required for hourly job");
      }
      consola.info(`Processing hourly summary for ${date} hour ${periodParam}...`);
      const result = await generateHourlySummary(db, date, periodParam);
      if (result) {
        consola.success(`Hourly summary generated for hour ${periodParam}`);
      } else {
        consola.debug(`No data for hourly summary ${date} hour ${periodParam}`);
      }
      break;
    }

    case "daily": {
      consola.info(`Processing daily summary for ${date}...`);
      const result = await generateDailySummary(db, date);
      if (result) {
        consola.success(`Daily summary generated for ${date}`);
      } else {
        consola.debug(`No hourly summaries found for daily summary ${date}`);
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

export function startScheduler(db: AdasDatabase): () => void {
  consola.info("Starting summary scheduler with queue-based processing");

  const stats = getQueueStats(db);
  consola.debug(`Queue stats: ${JSON.stringify(stats)}`);

  const stopEnqueue = startEnqueueScheduler(db);
  const stopWorker = startWorker(db);

  return () => {
    stopEnqueue();
    stopWorker();
  };
}
