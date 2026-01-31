/**
 * AI Job Worker
 *
 * ジョブタイプごとにハンドラーを呼び出して処理を実行
 */

import type { AdasDatabase } from "@repo/db";
import type { AIJobType } from "@repo/types";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { dequeueJob, markJobCompleted, markJobFailed } from "./queue.js";

/** ジョブ結果 */
export interface JobResult {
  success: boolean;
  resultSummary: string;
  data?: unknown;
}

/** ジョブハンドラー型 */
export type JobHandler = (
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
) => Promise<JobResult>;

/** ジョブハンドラーマップ */
const handlers: Map<AIJobType, JobHandler> = new Map();

/**
 * ジョブハンドラーを登録
 */
export function registerJobHandler(jobType: AIJobType, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

/** 処理結果 */
export interface ProcessJobResult {
  processed: boolean;
  jobId?: number;
  jobType?: string;
  status?: "completed" | "failed";
  resultSummary?: string | null;
}

/**
 * 単一ジョブを処理
 */
export async function processJob(db: AdasDatabase, config: AdasConfig): Promise<ProcessJobResult> {
  const job = dequeueJob(db);

  if (!job) {
    return { processed: false };
  }

  const handler = handlers.get(job.jobType as AIJobType);

  if (!handler) {
    consola.error(`No handler for job type: ${job.jobType}`);
    markJobFailed(db, job.id, `No handler for job type: ${job.jobType}`);
    return {
      processed: true,
      jobId: job.id,
      jobType: job.jobType,
      status: "failed",
      resultSummary: `No handler for job type: ${job.jobType}`,
    };
  }

  const params = job.params ? JSON.parse(job.params) : {};

  try {
    consola.info(`Processing job ${job.id} (${job.jobType})`);
    const result = await handler(db, config, params);

    if (result.success) {
      markJobCompleted(db, job.id, result.data ?? null, result.resultSummary);
      consola.success(`Job ${job.id} completed: ${result.resultSummary}`);
      return {
        processed: true,
        jobId: job.id,
        jobType: job.jobType,
        status: "completed",
        resultSummary: result.resultSummary,
      };
    }
    markJobFailed(db, job.id, result.resultSummary);
    consola.warn(`Job ${job.id} failed: ${result.resultSummary}`);
    return {
      processed: true,
      jobId: job.id,
      jobType: job.jobType,
      status: "failed",
      resultSummary: result.resultSummary,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    consola.error(`Job ${job.id} error: ${errorMessage}`);
    markJobFailed(db, job.id, errorMessage);
    return {
      processed: true,
      jobId: job.id,
      jobType: job.jobType,
      status: "failed",
      resultSummary: errorMessage,
    };
  }
}

/**
 * キュー内の全ジョブを処理
 */
export async function processAllJobs(db: AdasDatabase, config: AdasConfig): Promise<number> {
  let processed = 0;

  while (await processJob(db, config)) {
    processed++;
  }

  return processed;
}
