/**
 * Learnings API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { LearningSourceType } from "@repo/types";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import type { AdasConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";
import { getSSENotifier } from "../../utils/sse-notifier.js";
import { getVocabularyTerms } from "../../utils/vocabulary.js";

interface ExplainLearningResponse {
  explanation: string;
  keyPoints: string[];
  relatedTopics: string[];
  practicalExamples?: string[];
}

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
   * - projectId: number (optional, filters by project)
   * - noProject: boolean (optional, filters learnings without project)
   * - dueForReview: boolean (optional, returns only items due for review)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const category = c.req.query("category");
    const sourceType = c.req.query("sourceType") as LearningSourceType | undefined;
    const sourceId = c.req.query("sourceId");
    const projectIdStr = c.req.query("projectId");
    const noProject = c.req.query("noProject") === "true";
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

    if (projectIdStr) {
      const projectId = Number.parseInt(projectIdStr, 10);
      if (!Number.isNaN(projectId)) {
        conditions.push(eq(schema.learnings.projectId, projectId));
      }
    } else if (noProject) {
      conditions.push(isNull(schema.learnings.projectId));
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
   * POST /api/learnings
   *
   * Create a new learning manually
   * Body: { content: string, date?: string, category?: string, tags?: string[], projectId?: number }
   */
  router.post("/", async (c) => {
    const body = await c.req.json<{
      content: string;
      date?: string;
      category?: string;
      tags?: string[];
      projectId?: number;
    }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: "content is required" }, 400);
    }

    const date = body.date ?? getTodayDateString();
    const sourceId = `manual-${Date.now()}`;

    const newLearning = {
      sourceType: "manual" as const,
      sourceId,
      projectId: body.projectId ?? null,
      date,
      content: body.content.trim(),
      category: body.category ?? null,
      tags: body.tags ? JSON.stringify(body.tags) : null,
      confidence: 1.0, // Manual entries have 100% confidence
      repetitionCount: 0,
      easeFactor: 2.5,
      interval: 0,
      nextReviewAt: null,
      lastReviewedAt: null,
    };

    const result = db.insert(schema.learnings).values(newLearning).returning().get();

    return c.json(result, 201);
  });

  /**
   * GET /api/learnings/export
   *
   * Export learnings as JSON
   * Query params: date, category, sourceType, projectId (optional filters)
   */
  router.get("/export", (c) => {
    const date = c.req.query("date");
    const category = c.req.query("category");
    const sourceType = c.req.query("sourceType") as LearningSourceType | undefined;
    const projectIdStr = c.req.query("projectId");

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

    if (projectIdStr) {
      const projectId = Number.parseInt(projectIdStr, 10);
      if (!Number.isNaN(projectId)) {
        conditions.push(eq(schema.learnings.projectId, projectId));
      }
    }

    let query = db.select().from(schema.learnings).orderBy(desc(schema.learnings.createdAt));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const learnings = query.all();

    // Export format: include parsed tags for convenience
    const exportData = learnings.map((l) => ({
      id: l.id,
      date: l.date,
      content: l.content,
      category: l.category,
      tags: l.tags ? JSON.parse(l.tags) : [],
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      projectId: l.projectId,
      confidence: l.confidence,
      createdAt: l.createdAt,
    }));

    return c.json(exportData);
  });

  /**
   * POST /api/learnings/import
   *
   * Import learnings from JSON array
   * Body: Array of { content: string, date?: string, category?: string, tags?: string[], projectId?: number }
   */
  router.post("/import", async (c) => {
    const body =
      await c.req.json<
        Array<{
          content: string;
          date?: string;
          category?: string;
          tags?: string[];
          projectId?: number;
        }>
      >();

    if (!Array.isArray(body)) {
      return c.json({ error: "Request body must be an array" }, 400);
    }

    const today = getTodayDateString();
    const results = { imported: 0, skipped: 0, errors: [] as string[] };

    for (const item of body) {
      if (!item.content || item.content.trim().length === 0) {
        results.errors.push("Skipped item with empty content");
        results.skipped++;
        continue;
      }

      const date = item.date ?? today;
      const content = item.content.trim();

      // Check for duplicates (same content and date)
      const existing = db
        .select()
        .from(schema.learnings)
        .where(and(eq(schema.learnings.content, content), eq(schema.learnings.date, date)))
        .get();

      if (existing) {
        results.skipped++;
        continue;
      }

      const sourceId = `manual-import-${Date.now()}-${results.imported}`;

      db.insert(schema.learnings)
        .values({
          sourceType: "manual",
          sourceId,
          projectId: item.projectId ?? null,
          date,
          content,
          category: item.category ?? null,
          tags: item.tags ? JSON.stringify(item.tags) : null,
          confidence: 1.0,
          repetitionCount: 0,
          easeFactor: 2.5,
          interval: 0,
          nextReviewAt: null,
          lastReviewedAt: null,
        })
        .run();

      results.imported++;
    }

    return c.json(results);
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

    // SSE でバッジ更新を通知
    getSSENotifier()?.emitBadgesUpdated(db);

    return c.json(updated);
  });

  /**
   * PUT /api/learnings/:id
   *
   * Update a learning
   * Body: { content?: string, category?: string | null, tags?: string[] | null, projectId?: number | null }
   */
  router.put("/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const body = await c.req.json<{
      content?: string;
      category?: string | null;
      tags?: string[] | null;
      projectId?: number | null;
    }>();

    const existing = db.select().from(schema.learnings).where(eq(schema.learnings.id, id)).get();

    if (!existing) {
      return c.json({ error: "Learning not found" }, 404);
    }

    const updateData: Record<string, unknown> = {};

    if (body.content !== undefined) updateData.content = body.content.trim();
    if (body.category !== undefined) updateData.category = body.category;
    if (body.tags !== undefined) updateData.tags = body.tags ? JSON.stringify(body.tags) : null;
    if (body.projectId !== undefined) updateData.projectId = body.projectId;

    if (Object.keys(updateData).length === 0) {
      return c.json(existing);
    }

    db.update(schema.learnings).set(updateData).where(eq(schema.learnings.id, id)).run();

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
   * POST /api/learnings/:id/explain
   *
   * Generate a detailed explanation for a learning using AI
   */
  router.post("/:id/explain", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const id = Number.parseInt(c.req.param("id"), 10);

    const learning = db.select().from(schema.learnings).where(eq(schema.learnings.id, id)).get();

    if (!learning) {
      return c.json({ error: "Learning not found" }, 404);
    }

    const { url, timeout } = config.worker;

    // Get vocabulary terms
    const vocabulary = getVocabularyTerms(db);

    // Get user profile for context
    const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();
    let userProfile:
      | {
          experienceYears?: number;
          specialties?: string[];
          knownTechnologies?: string[];
          learningGoals?: string[];
        }
      | undefined;

    if (profile) {
      userProfile = {
        experienceYears: profile.experienceYears ?? undefined,
        specialties: profile.specialties ? JSON.parse(profile.specialties) : undefined,
        knownTechnologies: profile.knownTechnologies
          ? JSON.parse(profile.knownTechnologies)
          : undefined,
        learningGoals: profile.learningGoals ? JSON.parse(profile.learningGoals) : undefined,
      };
    }

    // Get project name if learning has projectId
    let projectName: string | undefined;
    if (learning.projectId) {
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, learning.projectId))
        .get();
      projectName = project?.name;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${url}/rpc/explain-learning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: learning.content,
          category: learning.category,
          tags: learning.tags,
          projectName,
          userProfile,
          vocabulary,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return c.json({ error: `Worker error: ${errorText}` }, 500);
      }

      const result = (await response.json()) as ExplainLearningResponse;
      return c.json(result);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return c.json({ error: "Request timeout" }, 504);
      }
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  /**
   * POST /api/learnings/extract/transcriptions
   *
   * Extract learnings from transcription segments (async queue)
   * Body: { date?: string, segmentIds?: number[] }
   */
  router.post("/extract/transcriptions", async (c) => {
    const body = await c.req.json<{ date?: string; segmentIds?: number[] }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "learning-extract", {
      sourceType: "transcription",
      date,
      segmentIds: body.segmentIds,
    });

    return c.json({
      success: true,
      jobId,
      message: "学び抽出ジョブをキューに追加しました",
    });
  });

  /**
   * POST /api/learnings/extract/github-comments
   *
   * Extract learnings from GitHub comments (async queue)
   * Body: { date?: string }
   */
  router.post("/extract/github-comments", async (c) => {
    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "learning-extract", {
      sourceType: "github-comment",
      date,
    });

    return c.json({
      success: true,
      jobId,
      message: "学び抽出ジョブをキューに追加しました",
    });
  });

  /**
   * POST /api/learnings/extract/slack-messages
   *
   * Extract learnings from Slack messages (async queue)
   * Body: { date?: string }
   */
  router.post("/extract/slack-messages", async (c) => {
    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "learning-extract", {
      sourceType: "slack-message",
      date,
    });

    return c.json({
      success: true,
      jobId,
      message: "学び抽出ジョブをキューに追加しました",
    });
  });

  return router;
}
