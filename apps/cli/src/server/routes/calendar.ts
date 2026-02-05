/**
 * Calendar Events API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueCalendarJob } from "../../calendar/queue.js";

export function createCalendarRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/calendar
   *
   * Query params:
   * - date: YYYY-MM-DD (optional, filters by exact date)
   * - startDate: YYYY-MM-DD (optional, range filter start)
   * - endDate: YYYY-MM-DD (optional, range filter end)
   * - unread: true | false (optional, filters by read status)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const unreadStr = c.req.query("unread");
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    // Build conditions
    const conditions = [];

    if (date) {
      conditions.push(eq(schema.calendarEvents.date, date));
    }

    if (startDate) {
      conditions.push(gte(schema.calendarEvents.date, startDate));
    }

    if (endDate) {
      conditions.push(lte(schema.calendarEvents.date, endDate));
    }

    if (unreadStr === "true") {
      conditions.push(eq(schema.calendarEvents.isRead, false));
    } else if (unreadStr === "false") {
      conditions.push(eq(schema.calendarEvents.isRead, true));
    }

    // Execute query
    let query = db
      .select()
      .from(schema.calendarEvents)
      .orderBy(schema.calendarEvents.startTime)
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const events = query.all();

    // Parse JSON fields
    const parsed = events.map((event) => ({
      ...event,
      attendees: event.attendees ? JSON.parse(event.attendees) : null,
      organizer: event.organizer ? JSON.parse(event.organizer) : null,
    }));

    return c.json(parsed);
  });

  /**
   * GET /api/calendar/today
   *
   * Returns today's events
   */
  router.get("/today", (c) => {
    const today = new Date().toISOString().split("T")[0]!;

    const events = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.date, today))
      .orderBy(schema.calendarEvents.startTime)
      .all();

    const parsed = events.map((event) => ({
      ...event,
      attendees: event.attendees ? JSON.parse(event.attendees) : null,
      organizer: event.organizer ? JSON.parse(event.organizer) : null,
    }));

    return c.json(parsed);
  });

  /**
   * GET /api/calendar/unread-count
   *
   * Returns count of unread events
   */
  router.get("/unread-count", (c) => {
    const date = c.req.query("date");

    const conditions = [eq(schema.calendarEvents.isRead, false)];

    if (date) {
      conditions.push(eq(schema.calendarEvents.date, date));
    }

    const events = db
      .select()
      .from(schema.calendarEvents)
      .where(and(...conditions))
      .all();

    return c.json({ count: events.length });
  });

  /**
   * GET /api/calendar/:id
   *
   * Returns a single event by ID
   */
  router.get("/:id", (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const event = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, id))
      .get();

    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    const parsed = {
      ...event,
      attendees: event.attendees ? JSON.parse(event.attendees) : null,
      organizer: event.organizer ? JSON.parse(event.organizer) : null,
    };

    return c.json(parsed);
  });

  /**
   * PATCH /api/calendar/:id
   *
   * Update event properties (e.g., mark as read)
   */
  router.patch("/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    const body = await c.req.json();

    const existing = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Event not found" }, 404);
    }

    const updates: Record<string, unknown> = {};

    if (typeof body.isRead === "boolean") {
      updates.isRead = body.isRead;
    }

    if (typeof body.projectId === "number" || body.projectId === null) {
      updates.projectId = body.projectId;
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    const updated = db
      .update(schema.calendarEvents)
      .set(updates)
      .where(eq(schema.calendarEvents.id, id))
      .returning()
      .get();

    return c.json(updated);
  });

  /**
   * PATCH /api/calendar/mark-read
   *
   * Mark multiple events as read
   */
  router.patch("/mark-read", async (c) => {
    const body = await c.req.json();
    const ids = body.ids as number[];

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids must be a non-empty array" }, 400);
    }

    let updatedCount = 0;
    for (const id of ids) {
      const result = db
        .update(schema.calendarEvents)
        .set({ isRead: true })
        .where(eq(schema.calendarEvents.id, id))
        .returning()
        .get();

      if (result) {
        updatedCount++;
      }
    }

    return c.json({ updated: updatedCount });
  });

  /**
   * PATCH /api/calendar/mark-all-read
   *
   * Mark all events as read (optionally filtered by date)
   *
   * Body:
   * - date: YYYY-MM-DD (optional, filters by exact date)
   * - startDate: YYYY-MM-DD (optional, range filter start)
   * - endDate: YYYY-MM-DD (optional, range filter end)
   */
  router.patch("/mark-all-read", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { date, startDate, endDate } = body as {
      date?: string;
      startDate?: string;
      endDate?: string;
    };

    const conditions = [eq(schema.calendarEvents.isRead, false)];

    if (date) {
      conditions.push(eq(schema.calendarEvents.date, date));
    }
    if (startDate) {
      conditions.push(gte(schema.calendarEvents.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(schema.calendarEvents.date, endDate));
    }

    const result = db
      .update(schema.calendarEvents)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning()
      .all();

    return c.json({ updated: result.length });
  });

  /**
   * POST /api/calendar/sync
   *
   * Trigger manual sync from Google Calendar
   *
   * Body:
   * - calendarId: string (optional, specific calendar to sync)
   */
  router.post("/sync", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { calendarId } = body as { calendarId?: string };

    const job = enqueueCalendarJob(db, {
      jobType: "fetch_events",
      calendarId: calendarId || undefined,
    });

    if (job) {
      return c.json({
        message: "Sync job enqueued",
        jobId: job.id,
        calendarId: calendarId || "all",
      });
    }

    return c.json({
      message: "Sync job already pending",
      calendarId: calendarId || "all",
    });
  });

  /**
   * GET /api/calendar/stats
   *
   * Returns calendar event statistics
   *
   * Query params:
   * - startDate: YYYY-MM-DD (optional)
   * - endDate: YYYY-MM-DD (optional)
   */
  router.get("/stats", (c) => {
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");

    const conditions = [];
    if (startDate) {
      conditions.push(gte(schema.calendarEvents.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(schema.calendarEvents.date, endDate));
    }

    let query = db.select().from(schema.calendarEvents);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const events = query.all();

    const stats = {
      total: events.length,
      unread: events.filter((e) => !e.isRead).length,
      read: events.filter((e) => e.isRead).length,
      byStatus: {
        confirmed: events.filter((e) => e.status === "confirmed").length,
        tentative: events.filter((e) => e.status === "tentative").length,
        cancelled: events.filter((e) => e.status === "cancelled").length,
      },
      allDay: events.filter((e) => e.isAllDay).length,
      withMeeting: events.filter((e) => e.conferenceLink).length,
    };

    return c.json(stats);
  });

  /**
   * POST /api/calendar
   *
   * Create a new calendar event (local only, not synced to Google)
   *
   * Body:
   * - date: YYYY-MM-DD (required)
   * - summary: string (required)
   * - startTime: ISO8601 (required)
   * - endTime: ISO8601 (required)
   * - description: string (optional)
   * - location: string (optional)
   * - isAllDay: boolean (optional, default: false)
   * - projectId: number (optional)
   */
  router.post("/", async (c) => {
    const body = await c.req.json();
    const {
      date,
      summary,
      startTime,
      endTime,
      description,
      location,
      isAllDay = false,
      projectId,
    } = body as {
      date: string;
      summary: string;
      startTime: string;
      endTime: string;
      description?: string;
      location?: string;
      isAllDay?: boolean;
      projectId?: number;
    };

    // Validation
    if (!date || !summary || !startTime || !endTime) {
      return c.json({ error: "date, summary, startTime, and endTime are required" }, 400);
    }

    // Generate a local event ID
    const eventId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    const result = db
      .insert(schema.calendarEvents)
      .values({
        date,
        eventId,
        calendarId: "local",
        summary,
        description: description || null,
        startTime,
        endTime,
        isAllDay,
        location: location || null,
        attendees: null,
        organizer: null,
        conferenceLink: null,
        status: "confirmed",
        isRead: false,
        projectId: projectId || null,
        syncedAt: now,
        createdAt: now,
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  /**
   * DELETE /api/calendar/:id
   *
   * Delete a calendar event
   */
  router.delete("/:id", (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const existing = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, id))
      .get();

    if (!existing) {
      return c.json({ error: "Event not found" }, 404);
    }

    db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, id)).run();

    return c.json({ deleted: true, id });
  });

  return router;
}
