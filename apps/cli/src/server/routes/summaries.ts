import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import { loadConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";

/** 時間範囲の最大値 (12時間) */
const MAX_TIME_RANGE_HOURS = 12;

export function createSummariesRouter(db: AdasDatabase) {
  const config = loadConfig();
  const router = new Hono();

  router.get("/", (c) => {
    const date = c.req.query("date");
    const type = c.req.query("type") as "times" | "daily" | undefined;

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
      type?: "times" | "daily";
      startHour?: number;
      endHour?: number;
    }>();
    const date = body.date ?? getTodayDateString();

    // Daily のみの場合
    if (body.type === "daily") {
      const jobId = enqueueJob(db, "summarize-daily", { date });
      return c.json({ success: true, jobId, message: "日次サマリ生成をキューに追加しました" });
    }

    // Times (時間範囲指定)
    if (body.startHour !== undefined && body.endHour !== undefined) {
      const { startHour, endHour } = body;

      // バリデーション
      if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
        return c.json({ success: false, error: "時間は 0-23 の範囲で指定してください" }, 400);
      }
      if (startHour > endHour) {
        return c.json({ success: false, error: "開始時間は終了時間以前にしてください" }, 400);
      }
      const timeRange = endHour - startHour + 1;
      if (timeRange > MAX_TIME_RANGE_HOURS) {
        return c.json(
          { success: false, error: `時間範囲は最大 ${MAX_TIME_RANGE_HOURS} 時間までです` },
          400,
        );
      }

      // Times サマリ生成をキューに追加
      const timesJobId = enqueueJob(db, "summarize-times", { date, startHour, endHour });

      // Daily サマリも自動的に再生成
      const dailyJobId = enqueueJob(db, "summarize-daily", { date });

      return c.json({
        success: true,
        jobIds: [timesJobId, dailyJobId],
        message: `${startHour}時〜${endHour}時のサマリ生成と日次サマリの再生成をキューに追加しました`,
      });
    }

    // デフォルト: Daily と (自動インターバル設定があれば) Times を一括生成
    const dailyJobId = enqueueJob(db, "summarize-daily", { date });
    const jobIds: string[] = [dailyJobId];

    const timesIntervalMinutes = config.summarizer.timesIntervalMinutes;
    if (timesIntervalMinutes > 0) {
      const hoursPerInterval = Math.max(1, Math.ceil(timesIntervalMinutes / 60));

      // 今日の場合は現在時刻まで、過去の日付は23時まで
      const today = getTodayDateString();
      const maxEndHour = date === today ? new Date().getHours() : 23;

      // 0時から maxEndHour まで、指定間隔で区切って複数の times サマリを生成
      const timeRanges: { startHour: number; endHour: number }[] = [];
      for (let hour = 0; hour <= maxEndHour; hour += hoursPerInterval) {
        const startHour = hour;
        const endHour = Math.min(hour + hoursPerInterval - 1, maxEndHour);
        timeRanges.push({ startHour, endHour });
      }

      // 各時間範囲のジョブをキューに追加
      for (const { startHour, endHour } of timeRanges) {
        const timesJobId = enqueueJob(db, "summarize-times", { date, startHour, endHour });
        jobIds.push(timesJobId);
      }

      const rangeDesc = timeRanges.map((r) => `${r.startHour}時〜${r.endHour}時`).join(", ");

      return c.json({
        success: true,
        jobIds,
        message: `日次サマリと ${timeRanges.length} 件の Times サマリ生成をキューに追加しました (${rangeDesc})`,
      });
    }

    return c.json({ success: true, jobIds, message: "日次サマリ生成をキューに追加しました" });
  });

  return router;
}
