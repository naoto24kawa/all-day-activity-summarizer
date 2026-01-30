/**
 * Claude Code Sessions API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createClaudeCodeClient } from "../../claude-code/client.js";
import { fetchAllSessions } from "../../claude-code/fetcher.js";
import type { AdasConfig } from "../../config.js";

export function createClaudeCodeSessionsRouter(db: AdasDatabase, config?: AdasConfig) {
  const router = new Hono();

  /**
   * GET /api/claude-code-sessions
   *
   * Query params:
   * - date: YYYY-MM-DD (optional, filters by date)
   * - project: string (optional, filters by project path/name)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const project = c.req.query("project");
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    // Build conditions
    const conditions = [];

    if (date) {
      conditions.push(eq(schema.claudeCodeSessions.date, date));
    }

    if (project) {
      conditions.push(
        sql`(${schema.claudeCodeSessions.projectPath} LIKE ${`%${project}%`} OR ${schema.claudeCodeSessions.projectName} LIKE ${`%${project}%`})`,
      );
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
   * Returns statistics for sessions
   * Query params:
   * - date: YYYY-MM-DD (optional, filters by date)
   */
  router.get("/stats", (c) => {
    const date = c.req.query("date");

    const sessions = date
      ? db
          .select()
          .from(schema.claudeCodeSessions)
          .where(eq(schema.claudeCodeSessions.date, date))
          .all()
      : db.select().from(schema.claudeCodeSessions).all();

    // Group by project
    const projectStats = new Map<
      string,
      {
        projectPath: string;
        projectName: string | null;
        sessionCount: number;
        totalUserMessages: number;
        totalAssistantMessages: number;
        totalToolUses: number;
      }
    >();

    for (const session of sessions) {
      const key = session.projectPath;
      const existing = projectStats.get(key);

      if (existing) {
        existing.sessionCount++;
        existing.totalUserMessages += session.userMessageCount;
        existing.totalAssistantMessages += session.assistantMessageCount;
        existing.totalToolUses += session.toolUseCount;
      } else {
        projectStats.set(key, {
          projectPath: session.projectPath,
          projectName: session.projectName,
          sessionCount: 1,
          totalUserMessages: session.userMessageCount,
          totalAssistantMessages: session.assistantMessageCount,
          totalToolUses: session.toolUseCount,
        });
      }
    }

    return c.json({
      totalSessions: sessions.length,
      totalProjects: projectStats.size,
      projects: Array.from(projectStats.values()),
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
   * POST /api/claude-code-sessions/sync
   *
   * Manually trigger a sync of all sessions
   */
  router.post("/sync", async (c) => {
    if (!config?.claudeCode.enabled) {
      return c.json({ error: "Claude Code integration is disabled" }, 400);
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
