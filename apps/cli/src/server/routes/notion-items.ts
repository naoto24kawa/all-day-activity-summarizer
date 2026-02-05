/**
 * Notion Items API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { notionDatabases, notionItems } from "@repo/db/schema";
import type { NotionItem, NotionUnreadCounts } from "@repo/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

export function createNotionItemsRouter(db: AdasDatabase) {
  const app = new Hono();

  /**
   * GET /api/notion-items
   * Notion アイテム一覧を取得
   */
  app.get("/", (c) => {
    const date = c.req.query("date");
    const unread = c.req.query("unread");
    const projectId = c.req.query("projectId");
    const databaseId = c.req.query("databaseId");
    const limit = Number(c.req.query("limit") ?? "100");

    const conditions = [];

    if (date) {
      conditions.push(eq(notionItems.date, date));
    }

    if (unread === "true") {
      conditions.push(eq(notionItems.isRead, false));
    }

    if (projectId) {
      conditions.push(eq(notionItems.projectId, Number(projectId)));
    }

    if (databaseId) {
      conditions.push(eq(notionItems.databaseId, databaseId));
    }

    const items = db
      .select()
      .from(notionItems)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(notionItems.lastEditedTime))
      .limit(limit)
      .all();

    return c.json(items);
  });

  /**
   * GET /api/notion-items/unread-count
   * 未読数を取得
   */
  app.get("/unread-count", (c) => {
    const date = c.req.query("date");

    const conditions = [eq(notionItems.isRead, false)];

    if (date) {
      conditions.push(eq(notionItems.date, date));
    }

    const counts = db
      .select({
        parentType: notionItems.parentType,
        count: sql<number>`count(*)`,
      })
      .from(notionItems)
      .where(and(...conditions))
      .groupBy(notionItems.parentType)
      .all();

    const result: NotionUnreadCounts = {
      total: 0,
      database: 0,
      page: 0,
    };

    for (const row of counts) {
      if (row.parentType === "database") {
        result.database = row.count;
      } else if (row.parentType === "page") {
        result.page = row.count;
      }
      result.total += row.count;
    }

    return c.json(result);
  });

  /**
   * PATCH /api/notion-items/:id/read
   * 既読にする
   */
  app.patch("/:id/read", (c) => {
    const id = Number(c.req.param("id"));

    const item = db.select().from(notionItems).where(eq(notionItems.id, id)).get();

    if (!item) {
      return c.json({ error: "Item not found" }, 404);
    }

    db.update(notionItems).set({ isRead: true }).where(eq(notionItems.id, id)).run();

    return c.json({ success: true });
  });

  /**
   * POST /api/notion-items/mark-all-read
   * 全て既読にする
   */
  app.post("/mark-all-read", async (c) => {
    const body = await c.req.json<{ date?: string; databaseId?: string }>();

    const conditions = [eq(notionItems.isRead, false)];

    if (body.date) {
      conditions.push(eq(notionItems.date, body.date));
    }

    if (body.databaseId) {
      conditions.push(eq(notionItems.databaseId, body.databaseId));
    }

    const result = db
      .update(notionItems)
      .set({ isRead: true })
      .where(and(...conditions))
      .run();

    return c.json({ updated: result.changes });
  });

  /**
   * GET /api/notion-items/:id
   * 単一アイテムを取得
   */
  app.get("/:id", (c) => {
    const id = Number(c.req.param("id"));

    const item = db.select().from(notionItems).where(eq(notionItems.id, id)).get();

    if (!item) {
      return c.json({ error: "Item not found" }, 404);
    }

    return c.json(item);
  });

  return app;
}

export function createNotionDatabasesRouter(db: AdasDatabase) {
  const app = new Hono();

  /**
   * GET /api/notion-databases
   * データベース一覧を取得
   */
  app.get("/", (c) => {
    const activeOnly = c.req.query("activeOnly") !== "false";

    const conditions = [];
    if (activeOnly) {
      conditions.push(eq(notionDatabases.isActive, true));
    }

    const databases = db
      .select()
      .from(notionDatabases)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(notionDatabases.updatedAt))
      .all();

    return c.json(databases);
  });

  /**
   * POST /api/notion-databases
   * データベースを追加
   */
  app.post("/", async (c) => {
    const body = await c.req.json<{
      databaseId: string;
      title?: string;
      url?: string;
      projectId?: number;
    }>();

    if (!body.databaseId) {
      return c.json({ error: "databaseId is required" }, 400);
    }

    // 既存チェック
    const existing = db
      .select()
      .from(notionDatabases)
      .where(eq(notionDatabases.databaseId, body.databaseId))
      .get();

    if (existing) {
      return c.json({ error: "Database already exists", database: existing }, 409);
    }

    const now = new Date().toISOString();
    const result = db
      .insert(notionDatabases)
      .values({
        databaseId: body.databaseId,
        title: body.title ?? "Untitled",
        url: body.url ?? `https://notion.so/${body.databaseId.replace(/-/g, "")}`,
        projectId: body.projectId ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  /**
   * PATCH /api/notion-databases/:id
   * データベースを更新
   */
  app.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json<{
      title?: string;
      projectId?: number | null;
      isActive?: boolean;
    }>();

    const existing = db.select().from(notionDatabases).where(eq(notionDatabases.id, id)).get();

    if (!existing) {
      return c.json({ error: "Database not found" }, 404);
    }

    const now = new Date().toISOString();
    const updates: Partial<typeof notionDatabases.$inferInsert> = { updatedAt: now };

    if (body.title !== undefined) updates.title = body.title;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    db.update(notionDatabases).set(updates).where(eq(notionDatabases.id, id)).run();

    const updated = db.select().from(notionDatabases).where(eq(notionDatabases.id, id)).get();

    return c.json(updated);
  });

  /**
   * DELETE /api/notion-databases/:id
   * データベースを削除 (非アクティブ化)
   */
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));

    const existing = db.select().from(notionDatabases).where(eq(notionDatabases.id, id)).get();

    if (!existing) {
      return c.json({ error: "Database not found" }, 404);
    }

    const now = new Date().toISOString();
    db.update(notionDatabases)
      .set({ isActive: false, updatedAt: now })
      .where(eq(notionDatabases.id, id))
      .run();

    return c.json({ success: true });
  });

  return app;
}
