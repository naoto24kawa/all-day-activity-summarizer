/**
 * Gmail Messages API Routes
 */

import type { AdasDatabase, NewGmailMessage } from "@repo/db";
import { schema } from "@repo/db";
import type {
  CreateGmailMessageRequest,
  GmailMessagePriority,
  GmailMessageType,
  GmailUnreadCounts,
} from "@repo/types";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { Hono } from "hono";

export function createGmailMessagesRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/gmail-messages
   *
   * Query params:
   * - date: YYYY-MM-DD (optional, filters by date)
   * - type: direct | cc | mailing_list | notification | newsletter (optional)
   * - unread: true | false (optional, filters by read status)
   * - starred: true | false (optional, filters by starred status)
   * - priority: high | medium | low (optional, filters by priority)
   * - label: string (optional, filters by Gmail label)
   * - projectId: number (optional, filters by project)
   * - noProject: true (optional, filters messages without project)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const type = c.req.query("type") as GmailMessageType | undefined;
    const unreadStr = c.req.query("unread");
    const starredStr = c.req.query("starred");
    const priority = c.req.query("priority") as GmailMessagePriority | undefined;
    const label = c.req.query("label");
    const projectIdStr = c.req.query("projectId");
    const noProject = c.req.query("noProject") === "true";
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    // Build conditions
    const conditions = [];

    if (date) {
      conditions.push(eq(schema.gmailMessages.date, date));
    }

    if (type) {
      conditions.push(eq(schema.gmailMessages.messageType, type));
    }

    if (unreadStr === "true") {
      conditions.push(eq(schema.gmailMessages.isRead, false));
    } else if (unreadStr === "false") {
      conditions.push(eq(schema.gmailMessages.isRead, true));
    }

    if (starredStr === "true") {
      conditions.push(eq(schema.gmailMessages.isStarred, true));
    } else if (starredStr === "false") {
      conditions.push(eq(schema.gmailMessages.isStarred, false));
    }

    if (priority) {
      conditions.push(eq(schema.gmailMessages.priority, priority));
    }

    // Label filtering (partial match in JSON array)
    if (label) {
      conditions.push(like(schema.gmailMessages.labels, `%"${label}"%`));
    }

    // Project filtering
    if (projectIdStr) {
      const projectId = Number.parseInt(projectIdStr, 10);
      conditions.push(eq(schema.gmailMessages.projectId, projectId));
    } else if (noProject) {
      conditions.push(isNull(schema.gmailMessages.projectId));
    }

    // Execute query
    let query = db
      .select()
      .from(schema.gmailMessages)
      .orderBy(desc(schema.gmailMessages.receivedAt))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const messages = query.all();

    return c.json(messages);
  });

  /**
   * GET /api/gmail-messages/:id
   *
   * Get a single Gmail message by ID
   */
  router.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const message = db
      .select()
      .from(schema.gmailMessages)
      .where(eq(schema.gmailMessages.id, id))
      .get();

    if (!message) {
      return c.json({ error: "Message not found" }, 404);
    }

    return c.json(message);
  });

  /**
   * POST /api/gmail-messages
   *
   * Create a new Gmail message (Upsert by messageId + threadId)
   */
  router.post("/", async (c) => {
    const body = await c.req.json<CreateGmailMessageRequest>();

    // Validate required fields
    const requiredFields = [
      "date",
      "messageId",
      "threadId",
      "fromEmail",
      "toEmails",
      "subject",
      "messageType",
      "receivedAt",
    ];
    const missingFields = requiredFields.filter((f) => !body[f as keyof typeof body]);
    if (missingFields.length > 0) {
      return c.json({ error: `Missing required fields: ${missingFields.join(", ")}` }, 400);
    }

    // Validate messageType
    const validMessageTypes = ["direct", "cc", "mailing_list", "notification", "newsletter"];
    if (!validMessageTypes.includes(body.messageType)) {
      return c.json(
        { error: `Invalid messageType. Must be one of: ${validMessageTypes.join(", ")}` },
        400,
      );
    }

    // Check for existing message (upsert by messageId + threadId)
    const existing = db
      .select()
      .from(schema.gmailMessages)
      .where(
        and(
          eq(schema.gmailMessages.messageId, body.messageId),
          eq(schema.gmailMessages.threadId, body.threadId),
        ),
      )
      .get();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing message (preserve isRead if not explicitly changed)
      db.update(schema.gmailMessages)
        .set({
          date: body.date,
          fromEmail: body.fromEmail,
          fromName: body.fromName ?? existing.fromName,
          toEmails: JSON.stringify(body.toEmails),
          ccEmails: body.ccEmails ? JSON.stringify(body.ccEmails) : existing.ccEmails,
          subject: body.subject,
          snippet: body.snippet ?? existing.snippet,
          body: body.body ?? existing.body,
          bodyPlain: body.bodyPlain ?? existing.bodyPlain,
          labels: body.labels ? JSON.stringify(body.labels) : existing.labels,
          hasAttachments: body.hasAttachments ?? existing.hasAttachments,
          messageType: body.messageType,
          isStarred: body.isStarred ?? existing.isStarred,
          priority: body.priority ?? existing.priority,
          projectId: body.projectId ?? existing.projectId,
          receivedAt: body.receivedAt,
          syncedAt: now,
        })
        .where(eq(schema.gmailMessages.id, existing.id))
        .run();

      const updated = db
        .select()
        .from(schema.gmailMessages)
        .where(eq(schema.gmailMessages.id, existing.id))
        .get();

      return c.json({ ...updated, updated: true }, 200);
    }

    // Insert new message
    const message: NewGmailMessage = {
      date: body.date,
      messageId: body.messageId,
      threadId: body.threadId,
      fromEmail: body.fromEmail,
      fromName: body.fromName ?? null,
      toEmails: JSON.stringify(body.toEmails),
      ccEmails: body.ccEmails ? JSON.stringify(body.ccEmails) : null,
      subject: body.subject,
      snippet: body.snippet ?? null,
      body: body.body ?? null,
      bodyPlain: body.bodyPlain ?? null,
      labels: body.labels ? JSON.stringify(body.labels) : null,
      hasAttachments: body.hasAttachments ?? false,
      messageType: body.messageType,
      isRead: body.isRead ?? false,
      isStarred: body.isStarred ?? false,
      priority: body.priority ?? null,
      projectId: body.projectId ?? null,
      receivedAt: body.receivedAt,
      syncedAt: now,
      createdAt: now,
    };

    const result = db.insert(schema.gmailMessages).values(message).returning().get();

    return c.json(result, 201);
  });

  /**
   * POST /api/gmail-messages/bulk
   *
   * Create multiple Gmail messages (Upsert)
   * Body: { messages: CreateGmailMessageRequest[] }
   */
  router.post("/bulk", async (c) => {
    const body = await c.req.json<{ messages: CreateGmailMessageRequest[] }>();

    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json({ error: "messages array is required" }, 400);
    }

    if (body.messages.length === 0) {
      return c.json({ inserted: 0, updated: 0, errors: [] });
    }

    if (body.messages.length > 100) {
      return c.json({ error: "Maximum 100 messages per request" }, 400);
    }

    const requiredFields = [
      "date",
      "messageId",
      "threadId",
      "fromEmail",
      "toEmails",
      "subject",
      "messageType",
      "receivedAt",
    ];
    const validMessageTypes = ["direct", "cc", "mailing_list", "notification", "newsletter"];

    const results = {
      inserted: 0,
      updated: 0,
      errors: [] as { index: number; error: string }[],
    };

    const now = new Date().toISOString();

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
      if (!validMessageTypes.includes(msg.messageType)) {
        results.errors.push({ index: i, error: `Invalid messageType: ${msg.messageType}` });
        continue;
      }

      // Check for existing (upsert)
      const existing = db
        .select()
        .from(schema.gmailMessages)
        .where(
          and(
            eq(schema.gmailMessages.messageId, msg.messageId),
            eq(schema.gmailMessages.threadId, msg.threadId),
          ),
        )
        .get();

      if (existing) {
        // Update existing
        db.update(schema.gmailMessages)
          .set({
            date: msg.date,
            fromEmail: msg.fromEmail,
            fromName: msg.fromName ?? existing.fromName,
            toEmails: JSON.stringify(msg.toEmails),
            ccEmails: msg.ccEmails ? JSON.stringify(msg.ccEmails) : existing.ccEmails,
            subject: msg.subject,
            snippet: msg.snippet ?? existing.snippet,
            body: msg.body ?? existing.body,
            bodyPlain: msg.bodyPlain ?? existing.bodyPlain,
            labels: msg.labels ? JSON.stringify(msg.labels) : existing.labels,
            hasAttachments: msg.hasAttachments ?? existing.hasAttachments,
            messageType: msg.messageType,
            isStarred: msg.isStarred ?? existing.isStarred,
            priority: msg.priority ?? existing.priority,
            projectId: msg.projectId ?? existing.projectId,
            receivedAt: msg.receivedAt,
            syncedAt: now,
          })
          .where(eq(schema.gmailMessages.id, existing.id))
          .run();
        results.updated++;
      } else {
        // Insert new
        const message: NewGmailMessage = {
          date: msg.date,
          messageId: msg.messageId,
          threadId: msg.threadId,
          fromEmail: msg.fromEmail,
          fromName: msg.fromName ?? null,
          toEmails: JSON.stringify(msg.toEmails),
          ccEmails: msg.ccEmails ? JSON.stringify(msg.ccEmails) : null,
          subject: msg.subject,
          snippet: msg.snippet ?? null,
          body: msg.body ?? null,
          bodyPlain: msg.bodyPlain ?? null,
          labels: msg.labels ? JSON.stringify(msg.labels) : null,
          hasAttachments: msg.hasAttachments ?? false,
          messageType: msg.messageType,
          isRead: msg.isRead ?? false,
          isStarred: msg.isStarred ?? false,
          priority: msg.priority ?? null,
          projectId: msg.projectId ?? null,
          receivedAt: msg.receivedAt,
          syncedAt: now,
          createdAt: now,
        };

        db.insert(schema.gmailMessages).values(message).run();
        results.inserted++;
      }
    }

    return c.json(results);
  });

  /**
   * GET /api/gmail-messages/unread-count
   *
   * Returns count of unread messages by type and priority
   */
  router.get("/unread-count", (c) => {
    const date = c.req.query("date");

    const conditions = [eq(schema.gmailMessages.isRead, false)];
    if (date) {
      conditions.push(eq(schema.gmailMessages.date, date));
    }

    const messages = db
      .select()
      .from(schema.gmailMessages)
      .where(and(...conditions))
      .all();

    const counts: GmailUnreadCounts = {
      total: messages.length,
      direct: 0,
      cc: 0,
      mailingList: 0,
      notification: 0,
      newsletter: 0,
      byPriority: {
        high: 0,
        medium: 0,
        low: 0,
        unassigned: 0,
      },
    };

    for (const msg of messages) {
      // Count by type
      switch (msg.messageType) {
        case "direct":
          counts.direct++;
          break;
        case "cc":
          counts.cc++;
          break;
        case "mailing_list":
          counts.mailingList++;
          break;
        case "notification":
          counts.notification++;
          break;
        case "newsletter":
          counts.newsletter++;
          break;
      }

      // Count by priority
      switch (msg.priority) {
        case "high":
          counts.byPriority.high++;
          break;
        case "medium":
          counts.byPriority.medium++;
          break;
        case "low":
          counts.byPriority.low++;
          break;
        default:
          counts.byPriority.unassigned++;
          break;
      }
    }

    return c.json(counts);
  });

  /**
   * PATCH /api/gmail-messages/:id/read
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
      .from(schema.gmailMessages)
      .where(eq(schema.gmailMessages.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Message not found" }, 404);
    }

    const result = db
      .update(schema.gmailMessages)
      .set({ isRead: true })
      .where(eq(schema.gmailMessages.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * PATCH /api/gmail-messages/:id/unread
   *
   * Mark a message as unread
   */
  router.patch("/:id/unread", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.gmailMessages)
      .where(eq(schema.gmailMessages.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Message not found" }, 404);
    }

    const result = db
      .update(schema.gmailMessages)
      .set({ isRead: false })
      .where(eq(schema.gmailMessages.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * PATCH /api/gmail-messages/:id/star
   *
   * Toggle star status
   */
  router.patch("/:id/star", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.gmailMessages)
      .where(eq(schema.gmailMessages.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Message not found" }, 404);
    }

    const body = await c.req
      .json<{ starred?: boolean }>()
      .catch(() => ({}) as { starred?: boolean });
    const newStarred = body.starred !== undefined ? body.starred : !existing.isStarred;

    const result = db
      .update(schema.gmailMessages)
      .set({ isStarred: newStarred })
      .where(eq(schema.gmailMessages.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * PUT /api/gmail-messages/:id
   *
   * Update a message (supports projectId, priority update)
   * Body: { projectId?: number | null, priority?: "high" | "medium" | "low" }
   */
  router.put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.gmailMessages)
      .where(eq(schema.gmailMessages.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Message not found" }, 404);
    }

    const body = await c.req.json<{
      projectId?: number | null;
      priority?: GmailMessagePriority | null;
    }>();

    const updateData: Partial<typeof existing> = {};

    if (body.projectId !== undefined) {
      updateData.projectId = body.projectId;
    }

    if (body.priority !== undefined) {
      if (body.priority !== null && !["high", "medium", "low"].includes(body.priority)) {
        return c.json({ error: "Invalid priority. Must be one of: high, medium, low" }, 400);
      }
      updateData.priority = body.priority;
    }

    if (Object.keys(updateData).length === 0) {
      return c.json(existing);
    }

    const result = db
      .update(schema.gmailMessages)
      .set(updateData)
      .where(eq(schema.gmailMessages.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/gmail-messages/mark-all-read
   *
   * Mark all messages as read
   * Body: { date?: string, type?: GmailMessageType }
   */
  router.post("/mark-all-read", async (c) => {
    const body = await c.req.json<{ date?: string; type?: GmailMessageType }>();

    const conditions = [eq(schema.gmailMessages.isRead, false)];

    if (body.date) {
      conditions.push(eq(schema.gmailMessages.date, body.date));
    }

    if (body.type) {
      conditions.push(eq(schema.gmailMessages.messageType, body.type));
    }

    const result = db
      .update(schema.gmailMessages)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning()
      .all();

    return c.json({ updated: result.length });
  });

  /**
   * DELETE /api/gmail-messages/:id
   *
   * Delete a Gmail message
   */
  router.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db
      .select()
      .from(schema.gmailMessages)
      .where(eq(schema.gmailMessages.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Message not found" }, 404);
    }

    db.delete(schema.gmailMessages).where(eq(schema.gmailMessages.id, id)).run();

    return c.json({ deleted: true });
  });

  return router;
}
