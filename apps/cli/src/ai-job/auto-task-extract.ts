/**
 * Auto Task Extract Helper
 *
 * データ取得完了時にタスク抽出ジョブを自動追加するヘルパー。
 * 設定チェック + 重複防止付き。
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { AIJobType } from "@repo/types";
import consola from "consola";
import { and, eq } from "drizzle-orm";
import type { AdasConfig } from "../config.js";
import { enqueueJob } from "./queue.js";

type TaskExtractSource =
  | "slack"
  | "github"
  | "githubComment"
  | "memo"
  | "transcription"
  | "claudeCode"
  | "notion";

const SOURCE_TO_JOB_TYPE: Record<TaskExtractSource, AIJobType> = {
  slack: "task-extract-slack",
  github: "task-extract-github",
  githubComment: "task-extract-github-comment",
  memo: "task-extract-memo",
  transcription: "task-extract-transcription",
  claudeCode: "task-extract-claude-code",
  notion: "task-extract-notion",
};

/**
 * タスク抽出ジョブを自動追加(設定チェック + 重複防止付き)
 *
 * @returns 追加されたジョブID。スキップされた場合は null
 */
export function enqueueTaskExtractIfEnabled(
  db: AdasDatabase,
  config: AdasConfig,
  source: TaskExtractSource,
  params?: Record<string, unknown>,
): number | null {
  // 設定チェック
  if (!config.taskAutoExtract.enabled) {
    return null;
  }
  if (!config.taskAutoExtract.sources[source]) {
    return null;
  }

  const jobType = SOURCE_TO_JOB_TYPE[source];

  // 同タイプの pending ジョブが既にあればスキップ
  const existingJob = db
    .select({ id: schema.aiJobQueue.id })
    .from(schema.aiJobQueue)
    .where(and(eq(schema.aiJobQueue.jobType, jobType), eq(schema.aiJobQueue.status, "pending")))
    .get();

  if (existingJob) {
    consola.debug(
      `[auto-task-extract] Skipped ${jobType}: pending job already exists (id=${existingJob.id})`,
    );
    return null;
  }

  const jobId = enqueueJob(db, jobType, params);
  consola.info(`[auto-task-extract] Enqueued ${jobType} (id=${jobId})`);
  return jobId;
}
