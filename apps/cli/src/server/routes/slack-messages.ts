/**
 * Slack Messages API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

export function createSlackMessagesRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/slack-messages
   *
   * Query params:
   * - date: YYYY-MM-DD (optional, defaults to today)
   * - type: mention | channel | dm (optional, filters by type)
   * - unread: true | false (optional, filters by read status)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const type = c.req.query("type") as "mention" | "channel" | "dm" | undefined;
    const unreadStr = c.req.query("unread");
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    // Build conditions
    const conditions = [];

    if (date) {
      conditions.push(eq(schema.slackMessages.date, date));
    }

    if (type) {
      conditions.push(eq(schema.slackMessages.messageType, type));
    }

    if (unreadStr === "true") {
      conditions.push(eq(schema.slackMessages.isRead, false));
    } else if (unreadStr === "false") {
      conditions.push(eq(schema.slackMessages.isRead, true));
    }

    // Execute query
    let query = db
      .select()
      .from(schema.slackMessages)
      .orderBy(desc(schema.slackMessages.messageTs))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const messages = query.all();

    return c.json(messages);
  });

  /**
   * GET /api/slack-messages/unread-count
   *
   * Returns count of unread messages
   */
  router.get("/unread-count", (c) => {
    const date = c.req.query("date");

    let query = db
      .select()
      .from(schema.slackMessages)
      .where(eq(schema.slackMessages.isRead, false));

    if (date) {
      query = db
        .select()
        .from(schema.slackMessages)
        .where(and(eq(schema.slackMessages.isRead, false), eq(schema.slackMessages.date, date)));
    }

    const messages = query.all();

    // Count by type
    const counts = {
      total: messages.length,
      mention: 0,
      channel: 0,
      dm: 0,
      keyword: 0,
    };

    for (const msg of messages) {
      const msgType = msg.messageType as keyof typeof counts;
      if (msgType in counts && msgType !== "total") {
        counts[msgType]++;
      }
    }

    return c.json(counts);
  });

  /**
   * PATCH /api/slack-messages/:id/read
   *
   * Mark a message as read
   */
  router.patch("/:id/read", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.slackMessages)
      .where(eq(schema.slackMessages.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Message not found" }, 404);
    }

    const result = db
      .update(schema.slackMessages)
      .set({ isRead: true })
      .where(eq(schema.slackMessages.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/slack-messages/mark-all-read
   *
   * Mark all messages as read
   * Body: { date?: string, type?: "mention" | "channel" | "dm" }
   */
  router.post("/mark-all-read", async (c) => {
    const body = await c.req.json<{ date?: string; type?: "mention" | "channel" | "dm" }>();

    const conditions = [eq(schema.slackMessages.isRead, false)];

    if (body.date) {
      conditions.push(eq(schema.slackMessages.date, body.date));
    }

    if (body.type) {
      conditions.push(eq(schema.slackMessages.messageType, body.type));
    }

    const result = db
      .update(schema.slackMessages)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning()
      .all();

    return c.json({ updated: result.length });
  });

  return router;
}
