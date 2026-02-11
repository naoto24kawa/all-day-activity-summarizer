/**
 * GitHub Comments API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

export function createGitHubCommentsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/github-comments
   *
   * Query params:
   * - type: issue_comment | review_comment | review (optional, filters by type)
   * - repoOwner: string (optional, filters by repo owner)
   * - repoName: string (optional, filters by repo name)
   * - itemNumber: number (optional, filters by issue/PR number)
   * - unread: true | false (optional, filters by read status)
   * - limit: number (optional, defaults to 1000)
   */
  router.get("/", (c) => {
    const type = c.req.query("type") as "issue_comment" | "review_comment" | "review" | undefined;
    const repoOwner = c.req.query("repoOwner");
    const repoName = c.req.query("repoName");
    const itemNumberStr = c.req.query("itemNumber");
    const unreadStr = c.req.query("unread");
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 1000;

    // Build conditions
    const conditions = [];

    if (type) {
      conditions.push(eq(schema.githubComments.commentType, type));
    }

    if (repoOwner) {
      conditions.push(eq(schema.githubComments.repoOwner, repoOwner));
    }

    if (repoName) {
      conditions.push(eq(schema.githubComments.repoName, repoName));
    }

    if (itemNumberStr) {
      const itemNumber = Number.parseInt(itemNumberStr, 10);
      if (!Number.isNaN(itemNumber)) {
        conditions.push(eq(schema.githubComments.itemNumber, itemNumber));
      }
    }

    if (unreadStr === "true") {
      conditions.push(eq(schema.githubComments.isRead, false));
    } else if (unreadStr === "false") {
      conditions.push(eq(schema.githubComments.isRead, true));
    }

    // Execute query
    let query = db
      .select()
      .from(schema.githubComments)
      .orderBy(desc(schema.githubComments.githubCreatedAt))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const comments = query.all();

    return c.json(comments);
  });

  /**
   * GET /api/github-comments/summary
   *
   * Returns repository-level comment summary
   */
  router.get("/summary", (c) => {
    const repositories = db
      .select({
        repoOwner: schema.githubComments.repoOwner,
        repoName: schema.githubComments.repoName,
        commentCount: sql<number>`COUNT(*)`.as("commentCount"),
        unreadCount:
          sql<number>`SUM(CASE WHEN ${schema.githubComments.isRead} = 0 THEN 1 ELSE 0 END)`.as(
            "unreadCount",
          ),
      })
      .from(schema.githubComments)
      .groupBy(schema.githubComments.repoOwner, schema.githubComments.repoName)
      .all();

    return c.json({ repositories });
  });

  /**
   * GET /api/github-comments/unread-count
   *
   * Returns count of unread comments by type
   */
  router.get("/unread-count", (c) => {
    const date = c.req.query("date");

    const conditions = [eq(schema.githubComments.isRead, false)];

    if (date) {
      conditions.push(eq(schema.githubComments.date, date));
    }

    const comments = db
      .select()
      .from(schema.githubComments)
      .where(and(...conditions))
      .all();

    // Count by type
    const counts = {
      total: comments.length,
      issueComment: 0,
      reviewComment: 0,
      review: 0,
    };

    for (const comment of comments) {
      if (comment.commentType === "issue_comment") {
        counts.issueComment++;
      } else if (comment.commentType === "review_comment") {
        counts.reviewComment++;
      } else if (comment.commentType === "review") {
        counts.review++;
      }
    }

    return c.json(counts);
  });

  /**
   * PATCH /api/github-comments/:id/read
   *
   * Mark a comment as read
   */
  router.patch("/:id/read", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.githubComments)
      .where(eq(schema.githubComments.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Comment not found" }, 404);
    }

    const result = db
      .update(schema.githubComments)
      .set({ isRead: true })
      .where(eq(schema.githubComments.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/github-comments/mark-all-read
   *
   * Mark all comments as read
   * Body: { date?: string, type?: "issue_comment" | "review_comment" | "review" }
   */
  router.post("/mark-all-read", async (c) => {
    const body = await c.req.json<{
      date?: string;
      type?: "issue_comment" | "review_comment" | "review";
    }>();

    const conditions = [eq(schema.githubComments.isRead, false)];

    if (body.date) {
      conditions.push(eq(schema.githubComments.date, body.date));
    }

    if (body.type) {
      conditions.push(eq(schema.githubComments.commentType, body.type));
    }

    const result = db
      .update(schema.githubComments)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning()
      .all();

    return c.json({ updated: result.length });
  });

  return router;
}
