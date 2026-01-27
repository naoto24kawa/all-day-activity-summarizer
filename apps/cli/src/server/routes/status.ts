import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getTodayDateString } from "../../utils/date.js";

export function createStatusRouter(db: AdasDatabase) {
  const router = new Hono();

  router.get("/", (c) => {
    const today = getTodayDateString();

    const segmentCount = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.transcriptionSegments)
      .where(eq(schema.transcriptionSegments.date, today))
      .get();

    const summaryCount = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.summaries)
      .where(eq(schema.summaries.date, today))
      .get();

    const latestSegment = db
      .select()
      .from(schema.transcriptionSegments)
      .where(eq(schema.transcriptionSegments.date, today))
      .orderBy(sql`start_time DESC`)
      .limit(1)
      .get();

    return c.json({
      date: today,
      transcriptionSegments: segmentCount?.count ?? 0,
      summaries: summaryCount?.count ?? 0,
      latestTranscriptionTime: latestSegment?.startTime ?? null,
      uptime: process.uptime(),
    });
  });

  return router;
}
