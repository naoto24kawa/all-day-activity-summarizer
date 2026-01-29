/**
 * Slack Users API Routes
 *
 * Manages Slack user display name mappings
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

export function createSlackUsersRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/slack-users
   *
   * Returns all Slack users with their display names and message counts
   */
  router.get("/", (c) => {
    // Get unique users from messages with counts
    const usersFromMessages = db
      .select({
        userId: schema.slackMessages.userId,
        userName: schema.slackMessages.userName,
        messageCount: sql<number>`count(*)`,
        firstSeen: sql<string>`min(${schema.slackMessages.createdAt})`,
        lastSeen: sql<string>`max(${schema.slackMessages.createdAt})`,
      })
      .from(schema.slackMessages)
      .groupBy(schema.slackMessages.userId)
      .orderBy(desc(sql`count(*)`))
      .all();

    // Get existing user mappings
    const userMappings = db.select().from(schema.slackUsers).all();

    const mappingMap = new Map(userMappings.map((u) => [u.userId, u]));

    // Merge data
    const result = usersFromMessages.map((msg) => {
      const mapping = mappingMap.get(msg.userId);
      return {
        userId: msg.userId,
        slackName: mapping?.slackName ?? msg.userName,
        displayName: mapping?.displayName ?? null,
        messageCount: msg.messageCount,
        firstSeen: msg.firstSeen,
        lastSeen: msg.lastSeen,
      };
    });

    return c.json(result);
  });

  /**
   * PATCH /api/slack-users/:userId
   *
   * Update display name for a user
   * Body: { displayName: string | null }
   */
  router.patch("/:userId", async (c) => {
    const userId = c.req.param("userId");
    const body = await c.req.json<{ displayName: string | null }>();

    const displayName = body.displayName?.trim() || null;

    // Check if mapping exists
    const existing = db
      .select()
      .from(schema.slackUsers)
      .where(eq(schema.slackUsers.userId, userId))
      .get();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      db.update(schema.slackUsers)
        .set({ displayName, updatedAt: now })
        .where(eq(schema.slackUsers.userId, userId))
        .run();
    } else {
      // Get slack name from messages
      const msg = db
        .select({ userName: schema.slackMessages.userName })
        .from(schema.slackMessages)
        .where(eq(schema.slackMessages.userId, userId))
        .limit(1)
        .get();

      // Insert new
      db.insert(schema.slackUsers)
        .values({
          userId,
          slackName: msg?.userName ?? null,
          displayName,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return c.json({ success: true, userId, displayName });
  });

  /**
   * DELETE /api/slack-users/:userId
   *
   * Remove custom display name (reset to default)
   */
  router.delete("/:userId", (c) => {
    const userId = c.req.param("userId");

    db.delete(schema.slackUsers).where(eq(schema.slackUsers.userId, userId)).run();

    return c.json({ success: true, userId });
  });

  return router;
}
