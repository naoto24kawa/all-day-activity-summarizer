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

// Re-export generator functions and types for backward compatibility
export {
  generateDailySummary,
  generateTimesSummary,
  type SummaryGenerateOptions,
} from "./generator.js";

// ---------------------------------------------------------------------------
// Enqueue Scheduler - 時間境界を検出してジョブを投入
// ---------------------------------------------------------------------------

export function startEnqueueScheduler(db: AdasDatabase, config: AdasConfig): () => void {
  let lastDailyDate = "";
  let lastTimesEnqueueTime = 0;
  const dailyScheduleHour = config.summarizer.dailyScheduleHour ?? 23;
  const timesIntervalMinutes = config.summarizer.timesIntervalMinutes ?? 0;

  const checkAndEnqueue = () => {
    const now = new Date();
    const date = getTodayDateString();
    const currentHour = now.getHours();

    // Times: 指定間隔ごとに自動生成 (0 = 無効)
    if (timesIntervalMinutes > 0) {
      const intervalMs = timesIntervalMinutes * 60 * 1000;
      const elapsed = now.getTime() - lastTimesEnqueueTime;

      if (elapsed >= intervalMs) {
        lastTimesEnqueueTime = now.getTime();

        // 直近の時間範囲を計算 (interval に基づく時間数)
        // 例: 60分間隔 → 直近1時間、30分間隔 → 直近1時間
        const hoursToSummarize = Math.max(1, Math.ceil(timesIntervalMinutes / 60));
        const endHour = currentHour;
        const startHour = Math.max(0, endHour - hoursToSummarize + 1);

        const job = enqueue(db, {
          jobType: "times",
          date,
          startHour,
          endHour,
        });
        if (job) {
          consola.info(`Enqueued times job for ${date} ${startHour}:00 - ${endHour}:59`);
        }
      }
    }

    // Daily: 指定時間以降に1日分をキューに追加
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
  if (timesIntervalMinutes > 0) {
    consola.info(`Times summary auto-generation every ${timesIntervalMinutes} minutes`);
  }

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
      // 自動生成では既存サマリがあればスキップ (上書きしない)
      const result = await generateTimesSummary(db, date, startHour, endHour, { overwrite: false });
      if (result) {
        consola.success(`Times summary generated for ${date} ${startHour}:00 - ${endHour}:59`);

        // dailySyncWithTimes が有効なら Daily もデバウンス付きでキューに追加
        const { loadConfig } = await import("../config.js");
        const config = loadConfig();
        if (config.summarizer.dailySyncWithTimes) {
          const { enqueueDailySummaryDebounced } = await import("../ai-job/queue.js");
          const jobId = enqueueDailySummaryDebounced(db, date);
          consola.info(`Daily sync enabled: enqueued daily summary job #${jobId} (debounced)`);
        }
      } else {
        consola.debug(
          `Skipped times summary ${date} ${startHour}:00 - ${endHour}:59 (no data or already exists)`,
        );
      }
      break;
    }

    case "daily": {
      consola.info(`Processing daily summary for ${date}...`);
      // 自動生成では既存サマリがあればスキップ (上書きしない)
      const result = await generateDailySummary(db, date, { overwrite: false });
      if (result) {
        consola.success(`Daily summary generated for ${date}`);
      } else {
        consola.debug(`Skipped daily summary ${date} (no data or already exists)`);
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
