import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

export function createFeedbacksRouter(db: AdasDatabase) {
  const router = new Hono();

  // GET /api/feedbacks?date=YYYY-MM-DD
  router.get("/", (c) => {
    const date = c.req.query("date");

    if (!date) {
      const all = db.select().from(schema.segmentFeedbacks).all();
      return c.json(all);
    }

    // segment_feedbacks にはdateがないので、segmentのdateでフィルタする
    const feedbacks = db
      .select({
        id: schema.segmentFeedbacks.id,
        segmentId: schema.segmentFeedbacks.segmentId,
        rating: schema.segmentFeedbacks.rating,
        target: schema.segmentFeedbacks.target,
        reason: schema.segmentFeedbacks.reason,
        createdAt: schema.segmentFeedbacks.createdAt,
      })
      .from(schema.segmentFeedbacks)
      .innerJoin(
        schema.transcriptionSegments,
        eq(schema.segmentFeedbacks.segmentId, schema.transcriptionSegments.id),
      )
      .where(eq(schema.transcriptionSegments.date, date))
      .all();

    return c.json(feedbacks);
  });

  return router;
}

export function createSegmentFeedbackRouter(db: AdasDatabase) {
  const router = new Hono();

  // POST /api/segments/:id/feedback
  router.post("/:id/feedback", async (c) => {
    const segmentId = Number(c.req.param("id"));

    if (Number.isNaN(segmentId)) {
      return c.json({ error: "Invalid segment ID" }, 400);
    }

    const body = await c.req.json<{
      rating: string;
      target?: string;
      reason?: string;
    }>();

    if (!body.rating || (body.rating !== "good" && body.rating !== "bad")) {
      return c.json({ error: "rating must be 'good' or 'bad'" }, 400);
    }

    const validTargets = ["interpret", "evaluate", "summarize-hourly", "summarize-daily"] as const;
    const target = body.target ?? "interpret";
    if (!validTargets.includes(target as (typeof validTargets)[number])) {
      return c.json({ error: `target must be one of: ${validTargets.join(", ")}` }, 400);
    }

    // セグメントの存在確認
    const segment = db
      .select()
      .from(schema.transcriptionSegments)
      .where(eq(schema.transcriptionSegments.id, segmentId))
      .get();

    if (!segment) {
      return c.json({ error: "Segment not found" }, 404);
    }

    const result = db
      .insert(schema.segmentFeedbacks)
      .values({
        segmentId,
        rating: body.rating as "good" | "bad",
        target: target as (typeof validTargets)[number],
        reason: body.reason ?? null,
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  return router;
}
