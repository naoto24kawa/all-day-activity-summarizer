/**
 * Slack Messages API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { SlackMessagePriority, SlackPriorityCounts } from "@repo/types";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";

/**
 * チャンネル一覧を取得してマップを作成
 */
function getChannelProjectMap(db: AdasDatabase): Map<string, number | null> {
  const channels = db.select().from(schema.slackChannels).all();
  const map = new Map<string, number | null>();
  for (const channel of channels) {
    map.set(channel.channelId, channel.projectId);
  }
  return map;
}

/**
 * メッセージに effectiveProjectId を付加
 * 優先順位: メッセージの projectId > チャンネルの projectId
 */
function addEffectiveProjectId<T extends { channelId: string; projectId: number | null }>(
  messages: T[],
  channelProjectMap: Map<string, number | null>,
): (T & { effectiveProjectId: number | null })[] {
  return messages.map((msg) => ({
    ...msg,
    effectiveProjectId: msg.projectId ?? channelProjectMap.get(msg.channelId) ?? null,
  }));
}

export function createSlackMessagesRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/slack-messages
   *
   * Query params:
   * - type: mention | channel | dm (optional, filters by type)
   * - unread: true | false (optional, filters by read status)
   * - priority: high | medium | low (optional, filters by priority)
   * - projectId: number (optional, filters by project)
   * - noProject: true (optional, filters messages without project)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const type = c.req.query("type") as "mention" | "channel" | "dm" | undefined;
    const unreadStr = c.req.query("unread");
    const priority = c.req.query("priority") as SlackMessagePriority | undefined;
    const projectIdStr = c.req.query("projectId");
    const noProject = c.req.query("noProject") === "true";
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    // Build conditions
    const conditions = [];

    if (type) {
      conditions.push(eq(schema.slackMessages.messageType, type));
    }

    if (unreadStr === "true") {
      conditions.push(eq(schema.slackMessages.isRead, false));
    } else if (unreadStr === "false") {
      conditions.push(eq(schema.slackMessages.isRead, true));
    }

    // Priority filtering
    if (priority) {
      conditions.push(eq(schema.slackMessages.priority, priority));
    }

    // Project filtering
    if (projectIdStr) {
      const projectId = Number.parseInt(projectIdStr, 10);
      conditions.push(eq(schema.slackMessages.projectId, projectId));
    } else if (noProject) {
      conditions.push(isNull(schema.slackMessages.projectId));
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

    // effectiveProjectId を計算して付加
    const channelProjectMap = getChannelProjectMap(db);
    const messagesWithEffective = addEffectiveProjectId(messages, channelProjectMap);

    return c.json(messagesWithEffective);
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
   * PUT /api/slack-messages/:id
   *
   * Update a message (currently supports projectId update)
   * Body: { projectId?: number | null }
   */
  router.put("/:id", async (c) => {
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

    const body = await c.req.json<{ projectId?: number | null }>();
    const updateData: Partial<typeof existing> = {};

    if (body.projectId !== undefined) {
      updateData.projectId = body.projectId;
    }

    if (Object.keys(updateData).length === 0) {
      return c.json(existing);
    }

    const result = db
      .update(schema.slackMessages)
      .set(updateData)
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

  /**
   * GET /api/slack-messages/priority-counts
   *
   * Returns count of messages by priority (for unread messages only)
   */
  router.get("/priority-counts", (c) => {
    const unreadOnly = c.req.query("unreadOnly") !== "false"; // default true

    const conditions = unreadOnly ? [eq(schema.slackMessages.isRead, false)] : [];

    const messages =
      conditions.length > 0
        ? db
            .select()
            .from(schema.slackMessages)
            .where(and(...conditions))
            .all()
        : db.select().from(schema.slackMessages).all();

    const counts: SlackPriorityCounts = {
      total: messages.length,
      high: 0,
      medium: 0,
      low: 0,
      unassigned: 0,
    };

    for (const msg of messages) {
      const priority = msg.priority as SlackMessagePriority | null;
      if (priority === "high") {
        counts.high++;
      } else if (priority === "medium") {
        counts.medium++;
      } else if (priority === "low") {
        counts.low++;
      } else {
        counts.unassigned++;
      }
    }

    return c.json(counts);
  });

  /**
   * PATCH /api/slack-messages/:id/priority
   *
   * Manually update message priority
   * Body: { priority: "high" | "medium" | "low" }
   */
  router.patch("/:id/priority", async (c) => {
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

    const body = await c.req.json<{ priority: SlackMessagePriority }>();

    if (!body.priority || !["high", "medium", "low"].includes(body.priority)) {
      return c.json({ error: "Invalid priority. Must be one of: high, medium, low" }, 400);
    }

    const result = db
      .update(schema.slackMessages)
      .set({ priority: body.priority })
      .where(eq(schema.slackMessages.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/slack-messages/analyze-priorities
   *
   * Analyze priorities for existing messages that don't have one
   * Body: { limit?: number, messageIds?: number[] }
   */
  router.post("/analyze-priorities", async (c) => {
    const body = await c.req.json<{ limit?: number; messageIds?: number[] }>();
    const limit = body.limit ?? 50;

    let messages: (typeof schema.slackMessages.$inferSelect)[];

    if (body.messageIds && body.messageIds.length > 0) {
      // 指定されたメッセージ ID のみ
      messages = db
        .select()
        .from(schema.slackMessages)
        .where(
          and(
            inArray(schema.slackMessages.id, body.messageIds),
            isNull(schema.slackMessages.priority),
          ),
        )
        .limit(limit)
        .all();
    } else {
      // 優先度が未設定のメッセージを取得
      messages = db
        .select()
        .from(schema.slackMessages)
        .where(isNull(schema.slackMessages.priority))
        .orderBy(desc(schema.slackMessages.messageTs))
        .limit(limit)
        .all();
    }

    if (messages.length === 0) {
      return c.json({ queued: 0, message: "No messages to analyze" });
    }

    // ジョブをキューに登録
    const jobIds: number[] = [];
    for (const msg of messages) {
      const jobId = enqueueJob(db, "slack-priority", { messageId: msg.id });
      jobIds.push(jobId);
    }

    return c.json({
      queued: messages.length,
      jobIds,
      message: `Queued ${messages.length} messages for priority analysis`,
    });
  });

  return router;
}
