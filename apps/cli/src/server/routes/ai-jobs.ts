/**
 * AI Jobs API Routes
 *
 * AIジョブのキュー管理とSSE通知
 */

import type { AdasDatabase } from "@repo/db";
import type { AIJobStatus, CreateAIJobRequest, CreateAIJobResponse } from "@repo/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { enqueueJob, getJob, getJobStats, listJobs } from "../../ai-job/queue.js";
import { addJobCompletedListener } from "../../ai-job/scheduler.js";

export function createAIJobsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * POST /api/ai-jobs
   *
   * ジョブを登録
   */
  router.post("/", async (c) => {
    const body = await c.req.json<CreateAIJobRequest>();

    const { jobType, params, runAfter } = body;

    if (!jobType) {
      return c.json({ error: "jobType is required" }, 400);
    }

    const jobId = enqueueJob(db, jobType, params, runAfter);

    const response: CreateAIJobResponse = {
      jobId,
      status: "pending",
    };

    return c.json(response, 201);
  });

  /**
   * GET /api/ai-jobs
   *
   * ジョブ一覧を取得
   */
  router.get("/", (c) => {
    const status = c.req.query("status") as AIJobStatus | undefined;
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    const jobs = listJobs(db, { status, limit });

    return c.json(jobs);
  });

  /**
   * GET /api/ai-jobs/stats
   *
   * ジョブ統計を取得
   */
  router.get("/stats", (c) => {
    const stats = getJobStats(db);
    return c.json(stats);
  });

  /**
   * GET /api/ai-jobs/:id
   *
   * 特定のジョブを取得
   */
  router.get("/:id", (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const job = getJob(db, id);

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    return c.json(job);
  });

  /**
   * GET /api/ai-jobs/sse
   *
   * SSEでジョブ完了を通知
   */
  router.get("/sse", async (c) => {
    return streamSSE(c, async (stream) => {
      // ハートビート
      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: "heartbeat", data: "" });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // ジョブ完了リスナー
      const removeListener = addJobCompletedListener(async (jobId, jobType, resultSummary) => {
        try {
          await stream.writeSSE({
            event: "job_completed",
            data: JSON.stringify({
              jobId,
              jobType,
              status: "completed",
              resultSummary,
            }),
          });
        } catch {
          // クライアント切断時は無視
        }
      });

      // クリーンアップ
      stream.onAbort(() => {
        clearInterval(heartbeatInterval);
        removeListener();
      });

      // 接続維持
      await new Promise(() => {});
    });
  });

  return router;
}
