/**
 * GitHub Items API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getSSENotifier } from "../../utils/sse-notifier.js";

export function createGitHubItemsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/github-items
   *
   * Query params:
   * - type: issue | pull_request (optional, filters by type)
   * - state: open | closed | merged (optional, filters by state)
   * - unread: true | false (optional, filters by read status)
   * - reviewRequested: true | false (optional, filters by review request)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const type = c.req.query("type") as "issue" | "pull_request" | undefined;
    const state = c.req.query("state");
    const unreadStr = c.req.query("unread");
    const reviewRequestedStr = c.req.query("reviewRequested");
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    // Build conditions
    const conditions = [];

    if (type) {
      conditions.push(eq(schema.githubItems.itemType, type));
    }

    if (state) {
      conditions.push(eq(schema.githubItems.state, state));
    }

    if (unreadStr === "true") {
      conditions.push(eq(schema.githubItems.isRead, false));
    } else if (unreadStr === "false") {
      conditions.push(eq(schema.githubItems.isRead, true));
    }

    if (reviewRequestedStr === "true") {
      conditions.push(eq(schema.githubItems.isReviewRequested, true));
    }

    // Execute query
    let query = db
      .select()
      .from(schema.githubItems)
      .orderBy(desc(schema.githubItems.githubUpdatedAt))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const items = query.all();

    return c.json(items);
  });

  /**
   * GET /api/github-items/unread-count
   *
   * Returns count of unread items by type
   */
  router.get("/unread-count", (c) => {
    const date = c.req.query("date");

    const conditions = [eq(schema.githubItems.isRead, false)];

    if (date) {
      conditions.push(eq(schema.githubItems.date, date));
    }

    const items = db
      .select()
      .from(schema.githubItems)
      .where(and(...conditions))
      .all();

    // Count by type
    const counts = {
      total: items.length,
      issue: 0,
      pullRequest: 0,
      reviewRequest: 0,
    };

    for (const item of items) {
      if (item.itemType === "issue") {
        counts.issue++;
      } else if (item.itemType === "pull_request") {
        if (item.isReviewRequested) {
          counts.reviewRequest++;
        } else {
          counts.pullRequest++;
        }
      }
    }

    return c.json(counts);
  });

  /**
   * PATCH /api/github-items/:id/read
   *
   * Mark an item as read
   */
  router.patch("/:id/read", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.githubItems)
      .where(eq(schema.githubItems.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Item not found" }, 404);
    }

    const result = db
      .update(schema.githubItems)
      .set({ isRead: true })
      .where(eq(schema.githubItems.id, id))
      .returning()
      .get();

    // SSE でバッジ更新を通知
    getSSENotifier()?.emitBadgesUpdated(db);

    return c.json(result);
  });

  /**
   * POST /api/github-items/mark-all-read
   *
   * Mark all items as read
   * Body: { date?: string, type?: "issue" | "pull_request" }
   */
  router.post("/mark-all-read", async (c) => {
    const body = await c.req.json<{
      date?: string;
      type?: "issue" | "pull_request";
      reviewRequested?: boolean;
    }>();

    const conditions = [eq(schema.githubItems.isRead, false)];

    if (body.date) {
      conditions.push(eq(schema.githubItems.date, body.date));
    }

    if (body.type) {
      conditions.push(eq(schema.githubItems.itemType, body.type));
    }

    if (body.reviewRequested !== undefined) {
      conditions.push(eq(schema.githubItems.isReviewRequested, body.reviewRequested));
    }

    const result = db
      .update(schema.githubItems)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning()
      .all();

    // SSE でバッジ更新を通知
    getSSENotifier()?.emitBadgesUpdated(db);

    return c.json({ updated: result.length });
  });

  /**
   * POST /api/github-items/sync-projects
   *
   * Sync projectId for all github items based on repoOwner/repoName match
   * This updates existing items that don't have projectId yet
   * Uses project_repositories table for multiple repositories per project
   */
  router.post("/sync-projects", (c) => {
    // Get all project-repository mappings
    const projectRepos = db.select().from(schema.projectRepositories).all();

    let updated = 0;

    for (const repo of projectRepos) {
      // Update github items where repoOwner/repoName matches
      const result = db
        .update(schema.githubItems)
        .set({ projectId: repo.projectId })
        .where(
          and(
            eq(schema.githubItems.repoOwner, repo.githubOwner),
            eq(schema.githubItems.repoName, repo.githubRepo),
            isNull(schema.githubItems.projectId),
          ),
        )
        .returning()
        .all();

      updated += result.length;
    }

    // 後方互換性: projects テーブルの githubOwner/githubRepo からも同期
    const legacyProjects = db
      .select()
      .from(schema.projects)
      .where(and(isNotNull(schema.projects.githubOwner), isNotNull(schema.projects.githubRepo)))
      .all();

    for (const project of legacyProjects) {
      if (!project.githubOwner || !project.githubRepo) continue;

      const result = db
        .update(schema.githubItems)
        .set({ projectId: project.id })
        .where(
          and(
            eq(schema.githubItems.repoOwner, project.githubOwner),
            eq(schema.githubItems.repoName, project.githubRepo),
            isNull(schema.githubItems.projectId),
          ),
        )
        .returning()
        .all();

      updated += result.length;
    }

    return c.json({ updated });
  });

  /**
   * GET /api/github-items/projects
   *
   * Returns all projects that have github items
   * Used for grouping display
   */
  router.get("/projects", (c) => {
    // Get distinct project IDs from github items
    const itemsWithProjects = db
      .select({
        projectId: schema.githubItems.projectId,
      })
      .from(schema.githubItems)
      .where(isNotNull(schema.githubItems.projectId))
      .groupBy(schema.githubItems.projectId)
      .all();

    const projectIds = itemsWithProjects
      .map((i) => i.projectId)
      .filter((id): id is number => id !== null);

    if (projectIds.length === 0) {
      return c.json([]);
    }

    // Get project details
    const projects = db
      .select()
      .from(schema.projects)
      .all()
      .filter((p) => projectIds.includes(p.id));

    return c.json(projects);
  });

  return router;
}
