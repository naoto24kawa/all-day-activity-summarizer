import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import { getTodayDateString } from "../../utils/date.js";

export function createSummariesRouter(db: AdasDatabase) {
  const router = new Hono();

  router.get("/", (c) => {
    const date = c.req.query("date");
    const type = c.req.query("type") as "pomodoro" | "hourly" | "daily" | undefined;

    const query = db.select().from(schema.summaries);

    if (date && type) {
      return c.json(
        query
          .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, type)))
          .all(),
      );
    }
    if (date) {
      return c.json(query.where(eq(schema.summaries.date, date)).all());
    }
    if (type) {
      return c.json(query.where(eq(schema.summaries.summaryType, type)).all());
    }

    return c.json(query.all());
  });

  router.post("/generate", async (c) => {
    const body = await c.req.json<{
      date?: string;
      type?: "pomodoro" | "hourly" | "daily";
      hour?: number;
    }>();
    const date = body.date ?? getTodayDateString();

    const jobIds: number[] = [];

    if (body.type === "daily") {
      const jobId = enqueueJob(db, "summarize-daily", { date });
      return c.json({ success: true, jobId, message: "日次サマリ生成をキューに追加しました" });
    }

    if (body.hour !== undefined) {
      const jobId = enqueueJob(db, "summarize-hourly", { date, hour: body.hour });
      return c.json({
        success: true,
        jobId,
        message: `${body.hour}時台のサマリ生成をキューに追加しました`,
      });
    }

    // Generate all: pomodoro → hourly → daily をキューに追加
    for (let period = 0; period < 48; period++) {
      const hour = Math.floor(period / 2);
      const isSecondHalf = period % 2 === 1;
      const hh = String(hour).padStart(2, "0");
      const startTime = isSecondHalf ? `${date}T${hh}:30:00` : `${date}T${hh}:00:00`;
      const endTime = isSecondHalf ? `${date}T${hh}:59:59` : `${date}T${hh}:29:59`;
      const jobId = enqueueJob(db, "summarize-pomodoro", { date, startTime, endTime });
      jobIds.push(jobId);
    }

    for (let hour = 0; hour < 24; hour++) {
      const jobId = enqueueJob(db, "summarize-hourly", { date, hour });
      jobIds.push(jobId);
    }

    const dailyJobId = enqueueJob(db, "summarize-daily", { date });
    jobIds.push(dailyJobId);

    return c.json({
      success: true,
      jobIds,
      message: `${jobIds.length}件のサマリ生成ジョブをキューに追加しました`,
    });
  });

  return router;
}
