import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { generateDailySummary, generateHourlySummary } from "../../summarizer/scheduler.js";
import { getTodayDateString } from "../../utils/date.js";

export function createSummariesRouter(db: AdasDatabase) {
  const router = new Hono();

  router.get("/", (c) => {
    const date = c.req.query("date");
    const type = c.req.query("type") as "hourly" | "daily" | undefined;

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
    const body = await c.req.json<{ date?: string; type?: "hourly" | "daily"; hour?: number }>();
    const date = body.date ?? getTodayDateString();

    if (body.type === "daily") {
      const result = await generateDailySummary(db, date);
      return c.json({ success: !!result, content: result });
    }

    if (body.hour !== undefined) {
      const result = await generateHourlySummary(db, date, body.hour);
      return c.json({ success: !!result, content: result });
    }

    // Generate all hourly + daily
    const results: string[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const result = await generateHourlySummary(db, date, hour);
      if (result) results.push(result);
    }
    const daily = await generateDailySummary(db, date);

    return c.json({
      success: true,
      hourlyCount: results.length,
      dailyGenerated: !!daily,
    });
  });

  return router;
}
