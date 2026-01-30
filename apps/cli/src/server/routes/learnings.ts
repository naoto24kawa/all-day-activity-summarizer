/**
 * Learnings API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { LearningSourceType } from "@repo/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  extractAndSaveLearningsFromContent,
  hasExistingLearnings,
} from "../../claude-code/extractor.js";
import type { AdasConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";

export function createLearningsRouter(db: AdasDatabase, config?: AdasConfig) {
  const router = new Hono();

  /**
   * GET /api/learnings
   *
   * Query params:
   * - date: YYYY-MM-DD (optional, filters by date)
   * - category: string (optional, filters by category)
   * - sourceType: string (optional, filters by source type)
   * - sourceId: string (optional, filters by source id)
   * - dueForReview: boolean (optional, returns only items due for review)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const category = c.req.query("category");
    const sourceType = c.req.query("sourceType") as LearningSourceType | undefined;
    const sourceId = c.req.query("sourceId");
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

    if (sourceType) {
      conditions.push(eq(schema.learnings.sourceType, sourceType));
    }

    if (sourceId) {
      conditions.push(eq(schema.learnings.sourceId, sourceId));
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

    // Group by source type
    const bySourceType = new Map<string, number>();
    for (const learning of allLearnings) {
      const src = learning.sourceType;
      bySourceType.set(src, (bySourceType.get(src) || 0) + 1);
    }

    return c.json({
      total: allLearnings.length,
      dueForReview,
      byCategory: Object.fromEntries(byCategory),
      byDate: Object.fromEntries(byDate),
      bySourceType: Object.fromEntries(bySourceType),
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

  /**
   * POST /api/learnings/extract/transcriptions
   *
   * Extract learnings from transcription segments
   * Body: { date?: string, segmentIds?: number[] }
   */
  router.post("/extract/transcriptions", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string; segmentIds?: number[] }>();
    const date = body.date ?? getTodayDateString();

    // Get target segments
    let segments: Array<{
      id: number;
      date: string;
      transcription: string;
      interpretedText: string | null;
      speaker: string | null;
    }>;

    if (body.segmentIds && body.segmentIds.length > 0) {
      segments = db
        .select({
          id: schema.transcriptionSegments.id,
          date: schema.transcriptionSegments.date,
          transcription: schema.transcriptionSegments.transcription,
          interpretedText: schema.transcriptionSegments.interpretedText,
          speaker: schema.transcriptionSegments.speaker,
        })
        .from(schema.transcriptionSegments)
        .where(sql`${schema.transcriptionSegments.id} IN (${body.segmentIds.join(",")})`)
        .all();
    } else {
      segments = db
        .select({
          id: schema.transcriptionSegments.id,
          date: schema.transcriptionSegments.date,
          transcription: schema.transcriptionSegments.transcription,
          interpretedText: schema.transcriptionSegments.interpretedText,
          speaker: schema.transcriptionSegments.speaker,
        })
        .from(schema.transcriptionSegments)
        .where(eq(schema.transcriptionSegments.date, date))
        .all();
    }

    if (segments.length === 0) {
      return c.json({ extracted: 0, saved: 0, message: "No segments found" });
    }

    // Group segments into batches for extraction
    // Use date as source_id (one extraction per day)
    const sourceId = `transcription-${date}`;

    if (hasExistingLearnings(db, "transcription", sourceId)) {
      return c.json({
        extracted: 0,
        saved: 0,
        message: "Learnings already extracted for this date",
      });
    }

    // Format segments as messages
    const messages = segments.map((s) => ({
      role: s.speaker || "speaker",
      content: s.interpretedText || s.transcription,
    }));

    const result = await extractAndSaveLearningsFromContent(
      db,
      config,
      "transcription",
      sourceId,
      date,
      messages,
      { contextInfo: "音声文字起こしからの学び抽出" },
    );

    return c.json(result);
  });

  /**
   * POST /api/learnings/extract/github-comments
   *
   * Extract learnings from GitHub comments (especially PR reviews)
   * Body: { date?: string }
   */
  router.post("/extract/github-comments", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();

    // Get GitHub comments for the date
    const comments = db
      .select()
      .from(schema.githubComments)
      .where(eq(schema.githubComments.date, date))
      .all();

    if (comments.length === 0) {
      return c.json({ extracted: 0, saved: 0, message: "No comments found" });
    }

    // Use date as source_id
    const sourceId = `github-comment-${date}`;

    if (hasExistingLearnings(db, "github-comment", sourceId)) {
      return c.json({
        extracted: 0,
        saved: 0,
        message: "Learnings already extracted for this date",
      });
    }

    // Format comments as messages
    const messages = comments.map((c) => ({
      role: c.authorLogin || "reviewer",
      content: `[${c.commentType}] ${c.repoName}#${c.itemNumber}: ${c.body}`,
    }));

    const result = await extractAndSaveLearningsFromContent(
      db,
      config,
      "github-comment",
      sourceId,
      date,
      messages,
      { contextInfo: "GitHub PR レビューコメントからの学び抽出" },
    );

    return c.json(result);
  });

  /**
   * POST /api/learnings/extract/slack-messages
   *
   * Extract learnings from Slack messages (mentions, DMs)
   * Body: { date?: string }
   */
  router.post("/extract/slack-messages", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();

    // Get Slack messages for the date
    const messages = db
      .select()
      .from(schema.slackMessages)
      .where(eq(schema.slackMessages.date, date))
      .all();

    if (messages.length === 0) {
      return c.json({ extracted: 0, saved: 0, message: "No messages found" });
    }

    // Use date as source_id
    const sourceId = `slack-message-${date}`;

    if (hasExistingLearnings(db, "slack-message", sourceId)) {
      return c.json({
        extracted: 0,
        saved: 0,
        message: "Learnings already extracted for this date",
      });
    }

    // Format Slack messages
    const formattedMessages = messages.map((m) => ({
      role: m.userName || m.userId,
      content: `[${m.channelName || m.channelId}] ${m.text}`,
    }));

    const result = await extractAndSaveLearningsFromContent(
      db,
      config,
      "slack-message",
      sourceId,
      date,
      formattedMessages,
      { contextInfo: "Slack メッセージからの学び抽出" },
    );

    return c.json(result);
  });

  return router;
}
