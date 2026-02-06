/**
 * Dead Letter Queue (DLQ) API Routes
 *
 * 最終失敗したジョブの一覧表示、手動再実行、無視マーク
 */

import type { AdasDatabase } from "@repo/db";
import type { DLQOriginalQueue, DLQRetryResponse, DLQStatus } from "@repo/types";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import { enqueueCalendarJob } from "../../calendar/queue.js";
import { enqueueClaudeCodeJob } from "../../claude-code/queue.js";
import {
  getDLQJob,
  getDLQStats,
  ignoreDLQJob,
  listDLQJobs,
  markDLQRetried,
} from "../../dlq/index.js";
import { enqueueGitHubJob, type GitHubJobType } from "../../github/queue.js";
import { enqueueNotionJob } from "../../notion/queue.js";
import { enqueueSlackJob, type SlackJobType } from "../../slack/queue.js";
import {
  enqueue as enqueueSummaryJob,
  type JobType as SummaryJobType,
} from "../../summarizer/queue.js";

export function createDLQRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/dlq
   *
   * DLQ ジョブ一覧を取得
   */
  router.get("/", (c) => {
    const status = c.req.query("status") as DLQStatus | undefined;
    const queue = c.req.query("queue") as DLQOriginalQueue | undefined;
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    const jobs = listDLQJobs(db, { status, queue, limit });

    return c.json(jobs);
  });

  /**
   * GET /api/dlq/stats
   *
   * DLQ 統計を取得
   */
  router.get("/stats", (c) => {
    const stats = getDLQStats(db);
    return c.json(stats);
  });

  /**
   * POST /api/dlq/:id/retry
   *
   * DLQ ジョブを手動再実行
   */
  router.post("/:id/retry", (c) => {
    const dlqId = Number.parseInt(c.req.param("id"), 10);

    const dlqJob = getDLQJob(db, dlqId);

    if (!dlqJob) {
      return c.json({ success: false, error: "DLQ job not found" } satisfies DLQRetryResponse, 404);
    }

    if (dlqJob.status !== "dead") {
      return c.json(
        {
          success: false,
          error: `Cannot retry job with status: ${dlqJob.status}`,
        } satisfies DLQRetryResponse,
        400,
      );
    }

    // 元のキューにジョブを再登録
    let newJobId: number | null = null;

    try {
      switch (dlqJob.originalQueue) {
        case "ai_job": {
          newJobId = enqueueJob(db, dlqJob.jobType, dlqJob.params ?? undefined);
          break;
        }
        case "slack": {
          const job = enqueueSlackJob(db, {
            jobType: dlqJob.jobType as SlackJobType,
            channelId: dlqJob.params ?? undefined,
          });
          newJobId = job?.id ?? null;
          break;
        }
        case "github": {
          const job = enqueueGitHubJob(db, {
            jobType: dlqJob.jobType as GitHubJobType,
          });
          newJobId = job?.id ?? null;
          break;
        }
        case "claude_code": {
          const job = enqueueClaudeCodeJob(db, {
            jobType: dlqJob.jobType as "fetch_sessions",
            projectPath: dlqJob.params ?? undefined,
          });
          newJobId = job?.id ?? null;
          break;
        }
        case "notion": {
          const job = enqueueNotionJob(db, {
            jobType: dlqJob.jobType as "fetch_recent_pages" | "fetch_database_items",
            databaseId: dlqJob.params ?? undefined,
          });
          newJobId = job?.id ?? null;
          break;
        }
        case "calendar": {
          const job = enqueueCalendarJob(db, {
            jobType: dlqJob.jobType as "fetch_events",
            calendarId: dlqJob.params ?? undefined,
          });
          newJobId = job?.id ?? null;
          break;
        }
        case "summary": {
          const params = dlqJob.params ? JSON.parse(dlqJob.params) : {};
          const job = enqueueSummaryJob(db, {
            jobType: dlqJob.jobType as SummaryJobType,
            date: params.date ?? new Date().toISOString().split("T")[0],
            startHour: params.startHour,
            endHour: params.endHour,
          });
          newJobId = job?.id ?? null;
          break;
        }
        default:
          return c.json(
            {
              success: false,
              error: `Unknown queue type: ${dlqJob.originalQueue}`,
            } satisfies DLQRetryResponse,
            400,
          );
      }

      // DLQ ジョブを再実行済みとしてマーク
      markDLQRetried(db, dlqId);

      return c.json({
        success: true,
        newJobId: newJobId ?? undefined,
      } satisfies DLQRetryResponse);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: errorMessage } satisfies DLQRetryResponse, 500);
    }
  });

  /**
   * POST /api/dlq/:id/ignore
   *
   * DLQ ジョブを無視としてマーク
   */
  router.post("/:id/ignore", (c) => {
    const dlqId = Number.parseInt(c.req.param("id"), 10);

    const dlqJob = getDLQJob(db, dlqId);

    if (!dlqJob) {
      return c.json({ success: false, error: "DLQ job not found" }, 404);
    }

    if (dlqJob.status !== "dead") {
      return c.json(
        { success: false, error: `Cannot ignore job with status: ${dlqJob.status}` },
        400,
      );
    }

    const success = ignoreDLQJob(db, dlqId);

    return c.json({ success });
  });

  return router;
}
