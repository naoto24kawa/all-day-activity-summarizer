/**
 * Slack Messages API Routes
 */

import type { AdasDatabase, NewSlackMessage } from "@repo/db";
import { schema } from "@repo/db";
import type { SlackMessagePriority, SlackPriorityCounts } from "@repo/types";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import { insertMessageIfNotExists } from "../../slack/fetcher.js";
import { getSSENotifier } from "../../utils/sse-notifier.js";

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
   * POST /api/slack-messages
   *
   * Create a new Slack message (external input)
   * Body: {
   *   date: string (YYYY-MM-DD),
   *   messageTs: string,
   *   channelId: string,
   *   userId: string,
   *   messageType: "mention" | "channel" | "dm" | "keyword",
   *   text: string,
   *   channelName?: string,
   *   userName?: string,
   *   threadTs?: string,
   *   permalink?: string,
   *   isRead?: boolean,
   *   priority?: "high" | "medium" | "low",
   *   projectId?: number
   * }
   */
  router.post("/", async (c) => {
    const body = await c.req.json<Partial<NewSlackMessage>>();

    // Validate required fields
    const requiredFields = ["date", "messageTs", "channelId", "userId", "messageType", "text"];
    const missingFields = requiredFields.filter((f) => !body[f as keyof typeof body]);
    if (missingFields.length > 0) {
      return c.json({ error: `Missing required fields: ${missingFields.join(", ")}` }, 400);
    }

    // Validate messageType
    const validMessageTypes = ["mention", "channel", "dm", "keyword"];
    if (!validMessageTypes.includes(body.messageType as string)) {
      return c.json(
        { error: `Invalid messageType. Must be one of: ${validMessageTypes.join(", ")}` },
        400,
      );
    }

    // Check for existing message (upsert)
    const existing = db
      .select()
      .from(schema.slackMessages)
      .where(
        and(
          eq(schema.slackMessages.channelId, body.channelId!),
          eq(schema.slackMessages.messageTs, body.messageTs!),
        ),
      )
      .get();

    if (existing) {
      // Update existing message
      db.update(schema.slackMessages)
        .set({
          date: body.date!,
          userId: body.userId!,
          messageType: body.messageType as "mention" | "channel" | "dm" | "keyword",
          text: body.text!,
          channelName: body.channelName ?? existing.channelName,
          userName: body.userName ?? existing.userName,
          threadTs: body.threadTs ?? existing.threadTs,
          permalink: body.permalink ?? existing.permalink,
          priority: body.priority ?? existing.priority,
          projectId: body.projectId ?? existing.projectId,
        })
        .where(eq(schema.slackMessages.id, existing.id))
        .run();

      const updated = db
        .select()
        .from(schema.slackMessages)
        .where(eq(schema.slackMessages.id, existing.id))
        .get();

      return c.json({ ...updated, updated: true }, 200);
    }

    // Insert new message
    const message: NewSlackMessage = {
      date: body.date!,
      messageTs: body.messageTs!,
      channelId: body.channelId!,
      userId: body.userId!,
      messageType: body.messageType as "mention" | "channel" | "dm" | "keyword",
      text: body.text!,
      channelName: body.channelName ?? null,
      userName: body.userName ?? null,
      threadTs: body.threadTs ?? null,
      permalink: body.permalink ?? null,
      isRead: body.isRead ?? false,
      priority: body.priority ?? null,
      projectId: body.projectId ?? null,
    };

    const insertedId = insertMessageIfNotExists(db, message);

    // Fetch the inserted message
    const inserted = db
      .select()
      .from(schema.slackMessages)
      .where(eq(schema.slackMessages.id, insertedId!))
      .get();

    return c.json(inserted, 201);
  });

  /**
   * POST /api/slack-messages/bulk
   *
   * Create multiple Slack messages (external input)
   * Body: {
   *   messages: Array<{
   *     date: string (YYYY-MM-DD),
   *     messageTs: string,
   *     channelId: string,
   *     userId: string,
   *     messageType: "mention" | "channel" | "dm" | "keyword",
   *     text: string,
   *     channelName?: string,
   *     userName?: string,
   *     threadTs?: string,
   *     permalink?: string,
   *     isRead?: boolean,
   *     priority?: "high" | "medium" | "low",
   *     projectId?: number
   *   }>
   * }
   */
  router.post("/bulk", async (c) => {
    const body = await c.req.json<{ messages: Partial<NewSlackMessage>[] }>();

    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json({ error: "messages array is required" }, 400);
    }

    if (body.messages.length === 0) {
      return c.json({ inserted: 0, updated: 0, errors: [] });
    }

    if (body.messages.length > 100) {
      return c.json({ error: "Maximum 100 messages per request" }, 400);
    }

    const requiredFields = ["date", "messageTs", "channelId", "userId", "messageType", "text"];
    const validMessageTypes = ["mention", "channel", "dm", "keyword"];

    const results = {
      inserted: 0,
      updated: 0,
      errors: [] as { index: number; error: string }[],
    };

    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (!msg) continue;

      // Validate required fields
      const missingFields = requiredFields.filter((f) => !msg[f as keyof typeof msg]);
      if (missingFields.length > 0) {
        results.errors.push({
          index: i,
          error: `Missing required fields: ${missingFields.join(", ")}`,
        });
        continue;
      }

      // Validate messageType
      if (!validMessageTypes.includes(msg.messageType as string)) {
        results.errors.push({ index: i, error: `Invalid messageType: ${msg.messageType}` });
        continue;
      }

      // Check for existing (upsert)
      const existing = db
        .select()
        .from(schema.slackMessages)
        .where(
          and(
            eq(schema.slackMessages.channelId, msg.channelId!),
            eq(schema.slackMessages.messageTs, msg.messageTs!),
          ),
        )
        .get();

      if (existing) {
        // Update existing
        db.update(schema.slackMessages)
          .set({
            date: msg.date!,
            userId: msg.userId!,
            messageType: msg.messageType as "mention" | "channel" | "dm" | "keyword",
            text: msg.text!,
            channelName: msg.channelName ?? existing.channelName,
            userName: msg.userName ?? existing.userName,
            threadTs: msg.threadTs ?? existing.threadTs,
            permalink: msg.permalink ?? existing.permalink,
            priority: msg.priority ?? existing.priority,
            projectId: msg.projectId ?? existing.projectId,
          })
          .where(eq(schema.slackMessages.id, existing.id))
          .run();
        results.updated++;
      } else {
        // Insert new
        const message: NewSlackMessage = {
          date: msg.date!,
          messageTs: msg.messageTs!,
          channelId: msg.channelId!,
          userId: msg.userId!,
          messageType: msg.messageType as "mention" | "channel" | "dm" | "keyword",
          text: msg.text!,
          channelName: msg.channelName ?? null,
          userName: msg.userName ?? null,
          threadTs: msg.threadTs ?? null,
          permalink: msg.permalink ?? null,
          isRead: msg.isRead ?? false,
          priority: msg.priority ?? null,
          projectId: msg.projectId ?? null,
        };

        db.insert(schema.slackMessages)
          .values({
            ...message,
            createdAt: new Date().toISOString(),
          })
          .run();
        results.inserted++;
      }
    }

    return c.json(results);
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

    // SSE でバッジ更新を通知
    getSSENotifier()?.emitBadgesUpdated(db);

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

    // SSE でバッジ更新を通知
    getSSENotifier()?.emitBadgesUpdated(db);

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
