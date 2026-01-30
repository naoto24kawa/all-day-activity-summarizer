/**
 * Learnings API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";

export function createLearningsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/learnings
   *
   * Query params:
   * - date: YYYY-MM-DD (optional, filters by date)
   * - category: string (optional, filters by category)
   * - sessionId: string (optional, filters by session)
   * - dueForReview: boolean (optional, returns only items due for review)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const category = c.req.query("category");
    const sessionId = c.req.query("sessionId");
    const dueForReview = c.req.query("dueForReview") === "true";
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    const conditions = [];

    if (date) {
      conditions.push(eq(schema.learnings.date, date));
    }

    if (category) {
      conditions.push(eq(schema.learnings.category, category));
    }

    if (sessionId) {
      conditions.push(eq(schema.learnings.sessionId, sessionId));
    }

    if (dueForReview) {
      const now = new Date().toISOString();
      conditions.push(
        sql`(${schema.learnings.nextReviewAt} IS NULL OR ${schema.learnings.nextReviewAt} <= ${now})`,
      );
    }

    let query = db
      .select()
      .from(schema.learnings)
      .orderBy(desc(schema.learnings.createdAt))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const learnings = query.all();

    return c.json(learnings);
  });

  /**
   * GET /api/learnings/stats
   *
   * Returns learning statistics
   */
  router.get("/stats", (c) => {
    const allLearnings = db.select().from(schema.learnings).all();

    const now = new Date().toISOString();
    const dueForReview = allLearnings.filter(
      (l) => l.nextReviewAt === null || l.nextReviewAt <= now,
    ).length;

    // Group by category
    const byCategory = new Map<string, number>();
    for (const learning of allLearnings) {
      const cat = learning.category || "other";
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    }

    // Group by date (last 7 days)
    const byDate = new Map<string, number>();
    for (const learning of allLearnings) {
      byDate.set(learning.date, (byDate.get(learning.date) || 0) + 1);
    }

    return c.json({
      total: allLearnings.length,
      dueForReview,
      byCategory: Object.fromEntries(byCategory),
      byDate: Object.fromEntries(byDate),
    });
  });

  /**
   * GET /api/learnings/:id
   */
  router.get("/:id", (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const learning = db.select().from(schema.learnings).where(eq(schema.learnings.id, id)).get();

    if (!learning) {
      return c.json({ error: "Learning not found" }, 404);
    }

    return c.json(learning);
  });

  /**
   * PUT /api/learnings/:id/review
   *
   * Record a review result using SM-2 algorithm
   * Body: { quality: 0-5 }
   *   0 - Complete blackout
   *   1 - Incorrect, but remembered upon seeing answer
   *   2 - Incorrect, but easy to recall
   *   3 - Correct with difficulty
   *   4 - Correct with hesitation
   *   5 - Perfect recall
   */
  router.put("/:id/review", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const body = await c.req.json<{ quality: number }>();

    if (body.quality < 0 || body.quality > 5) {
      return c.json({ error: "quality must be between 0 and 5" }, 400);
    }

    const learning = db.select().from(schema.learnings).where(eq(schema.learnings.id, id)).get();

    if (!learning) {
      return c.json({ error: "Learning not found" }, 404);
    }

    // SM-2 Algorithm
    const quality = body.quality;
    let { easeFactor, interval, repetitionCount } = learning;

    if (quality < 3) {
      // Failed review - reset
      repetitionCount = 0;
      interval = 0;
    } else {
      // Successful review
      if (repetitionCount === 0) {
        interval = 1;
      } else if (repetitionCount === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitionCount++;
    }

    // Update ease factor
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

    // Calculate next review date
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + interval);

    db.update(schema.learnings)
      .set({
        repetitionCount,
        easeFactor,
        interval,
        nextReviewAt: nextReviewAt.toISOString(),
        lastReviewedAt: new Date().toISOString(),
      })
      .where(eq(schema.learnings.id, id))
      .run();

    const updated = db.select().from(schema.learnings).where(eq(schema.learnings.id, id)).get();

    return c.json(updated);
  });

  /**
   * DELETE /api/learnings/:id
   */
  router.delete("/:id", (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const learning = db.select().from(schema.learnings).where(eq(schema.learnings.id, id)).get();

    if (!learning) {
      return c.json({ error: "Learning not found" }, 404);
    }

    db.delete(schema.learnings).where(eq(schema.learnings.id, id)).run();

    return c.json({ success: true });
  });

  return router;
}
