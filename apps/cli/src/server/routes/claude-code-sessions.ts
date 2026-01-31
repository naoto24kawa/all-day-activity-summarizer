/**
 * Claude Code Sessions API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createClaudeCodeClient } from "../../claude-code/client.js";
import { fetchAllSessions } from "../../claude-code/fetcher.js";
import type { AdasConfig } from "../../config.js";
import { featureDisabledResponse } from "../errors.js";

export function createClaudeCodeSessionsRouter(db: AdasDatabase, config?: AdasConfig) {
  const router = new Hono();

  /**
   * GET /api/claude-code-sessions
   *
   * Query params:
   * - project: string (optional, filters by project path/name)
   * - projectId: number (optional, filters by ADAS project)
   * - noProject: true (optional, filters sessions without ADAS project)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const project = c.req.query("project");
    const projectIdStr = c.req.query("projectId");
    const noProject = c.req.query("noProject") === "true";
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    // Build conditions
    const conditions = [];

    if (project) {
      conditions.push(
        sql`(${schema.claudeCodeSessions.projectPath} LIKE ${`%${project}%`} OR ${schema.claudeCodeSessions.projectName} LIKE ${`%${project}%`})`,
      );
    }

    // ADAS project filtering
    if (projectIdStr) {
      const projectId = Number.parseInt(projectIdStr, 10);
      conditions.push(eq(schema.claudeCodeSessions.projectId, projectId));
    } else if (noProject) {
      conditions.push(isNull(schema.claudeCodeSessions.projectId));
    }

    // Execute query
    let query = db
      .select()
      .from(schema.claudeCodeSessions)
      .orderBy(desc(schema.claudeCodeSessions.startTime))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const sessions = query.all();

    return c.json(sessions);
  });

  /**
   * GET /api/claude-code-sessions/stats
   *
   * Returns statistics for sessions (SQL GROUP BY optimized)
   * Query params:
   * - date: YYYY-MM-DD (optional, filters by date)
   */
  router.get("/stats", (c) => {
    const date = c.req.query("date");

    // Use SQL GROUP BY for efficient aggregation
    const baseQuery = db
      .select({
        projectPath: schema.claudeCodeSessions.projectPath,
        projectName: sql<string | null>`MAX(${schema.claudeCodeSessions.projectName})`.as(
          "projectName",
        ),
        sessionCount: sql<number>`COUNT(*)`.as("sessionCount"),
        totalUserMessages:
          sql<number>`COALESCE(SUM(${schema.claudeCodeSessions.userMessageCount}), 0)`.as(
            "totalUserMessages",
          ),
        totalAssistantMessages:
          sql<number>`COALESCE(SUM(${schema.claudeCodeSessions.assistantMessageCount}), 0)`.as(
            "totalAssistantMessages",
          ),
        totalToolUses: sql<number>`COALESCE(SUM(${schema.claudeCodeSessions.toolUseCount}), 0)`.as(
          "totalToolUses",
        ),
      })
      .from(schema.claudeCodeSessions);

    const projects = date
      ? baseQuery
          .where(eq(schema.claudeCodeSessions.date, date))
          .groupBy(schema.claudeCodeSessions.projectPath)
          .all()
      : baseQuery.groupBy(schema.claudeCodeSessions.projectPath).all();

    // Calculate totals from aggregated results
    const totalSessions = projects.reduce((sum, p) => sum + p.sessionCount, 0);

    return c.json({
      totalSessions,
      totalProjects: projects.length,
      projects,
    });
  });

  /**
   * GET /api/claude-code-sessions/:sessionId/messages
   *
   * Returns messages for a specific session
   */
  router.get("/:sessionId/messages", (c) => {
    const sessionId = c.req.param("sessionId");

    const messages = db
      .select()
      .from(schema.claudeCodeMessages)
      .where(eq(schema.claudeCodeMessages.sessionId, sessionId))
      .orderBy(asc(schema.claudeCodeMessages.id))
      .all();

    return c.json(messages);
  });

  /**
   * PUT /api/claude-code-sessions/:id
   *
   * Update a session (currently supports projectId update)
   * Body: { projectId?: number | null }
   */
  router.put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.claudeCodeSessions)
      .where(eq(schema.claudeCodeSessions.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Session not found" }, 404);
    }

    const body = await c.req.json<{ projectId?: number | null }>();
    const updateData: Partial<typeof existing> = {};

    if (body.projectId !== undefined) {
      updateData.projectId = body.projectId;
    }

    if (Object.keys(updateData).length === 0) {
      return c.json(existing);
    }

    const result = db
      .update(schema.claudeCodeSessions)
      .set(updateData)
      .where(eq(schema.claudeCodeSessions.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/claude-code-sessions/sync
   *
   * Manually trigger a sync of all sessions
   */
  router.post("/sync", async (c) => {
    if (!config?.claudeCode.enabled) {
      return featureDisabledResponse(c, "claudeCode");
    }

    const client = createClaudeCodeClient();

    try {
      await client.connect();
      const result = await fetchAllSessions(db, client, config.claudeCode.projects, config);
      await client.disconnect();

      return c.json({
        success: true,
        fetched: result.fetched,
        stored: result.stored,
        learnings: result.learnings,
      });
    } catch (error) {
      await client.disconnect();
      return c.json(
        {
          error: "Failed to sync sessions",
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  return router;
}
