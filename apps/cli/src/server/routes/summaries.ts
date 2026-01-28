import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  generateDailySummary,
  generateHourlySummary,
  generatePomodoroSummary,
} from "../../summarizer/scheduler.js";
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

    if (body.type === "daily") {
      const result = await generateDailySummary(db, date);
      return c.json({ success: !!result, content: result });
    }

    if (body.hour !== undefined) {
      const result = await generateHourlySummary(db, date, body.hour);
      return c.json({ success: !!result, content: result });
    }

    // Generate all: pomodoro → hourly → daily
    const pomodoroResults: string[] = [];
    for (let period = 0; period < 48; period++) {
      const hour = Math.floor(period / 2);
      const isSecondHalf = period % 2 === 1;
      const hh = String(hour).padStart(2, "0");
      const startTime = isSecondHalf ? `${date}T${hh}:30:00` : `${date}T${hh}:00:00`;
      const endTime = isSecondHalf ? `${date}T${hh}:59:59` : `${date}T${hh}:29:59`;
      const result = await generatePomodoroSummary(db, date, startTime, endTime);
      if (result) pomodoroResults.push(result);
    }

    const hourlyResults: string[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const result = await generateHourlySummary(db, date, hour);
      if (result) hourlyResults.push(result);
    }

    const daily = await generateDailySummary(db, date);

    return c.json({
      success: true,
      pomodoroCount: pomodoroResults.length,
      hourlyCount: hourlyResults.length,
      dailyGenerated: !!daily,
    });
  });

  return router;
}
