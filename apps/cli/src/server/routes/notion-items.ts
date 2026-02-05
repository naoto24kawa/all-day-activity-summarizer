/**
 * Notion Items API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { type NewNotionItem, notionDatabases, notionItems } from "@repo/db/schema";
import type { NotionItem, NotionParentType, NotionUnreadCounts } from "@repo/types";
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
   * POST /api/notion-items
   * Notion アイテムを登録 (MCP からの外部入力用)
   *
   * Body: {
   *   date: string (YYYY-MM-DD),
   *   pageId: string (Notion Page ID),
   *   parentType: "database" | "page" | "workspace",
   *   title: string,
   *   url: string,
   *   lastEditedTime: string (ISO8601),
   *   parentId?: string,
   *   databaseId?: string,
   *   icon?: string,
   *   properties?: string (JSON),
   *   lastEditedBy?: string,
   *   isRead?: boolean,
   *   priority?: "high" | "medium" | "low",
   *   projectId?: number
   * }
   */
  app.post("/", async (c) => {
    const body = await c.req.json<Partial<NewNotionItem>>();

    // Validate required fields
    const requiredFields = ["date", "pageId", "parentType", "title", "url", "lastEditedTime"];
    const missingFields = requiredFields.filter((f) => !body[f as keyof typeof body]);
    if (missingFields.length > 0) {
      return c.json({ error: `Missing required fields: ${missingFields.join(", ")}` }, 400);
    }

    // Validate parentType
    const validParentTypes: NotionParentType[] = ["database", "page", "workspace"];
    if (!validParentTypes.includes(body.parentType as NotionParentType)) {
      return c.json(
        { error: `Invalid parentType. Must be one of: ${validParentTypes.join(", ")}` },
        400,
      );
    }

    // Validate priority if provided
    if (body.priority && !["high", "medium", "low"].includes(body.priority)) {
      return c.json({ error: "Invalid priority. Must be one of: high, medium, low" }, 400);
    }

    // Check for duplicate (by pageId)
    const existing = db
      .select()
      .from(notionItems)
      .where(eq(notionItems.pageId, body.pageId!))
      .get();

    if (existing) {
      // Update existing item
      const now = new Date().toISOString();
      db.update(notionItems)
        .set({
          date: body.date!,
          parentId: body.parentId ?? existing.parentId,
          parentType: body.parentType as NotionParentType,
          databaseId: body.databaseId ?? existing.databaseId,
          title: body.title!,
          url: body.url!,
          icon: body.icon ?? existing.icon,
          properties: body.properties ?? existing.properties,
          lastEditedTime: body.lastEditedTime!,
          lastEditedBy: body.lastEditedBy ?? existing.lastEditedBy,
          priority: body.priority ?? existing.priority,
          projectId: body.projectId ?? existing.projectId,
          syncedAt: now,
        })
        .where(eq(notionItems.id, existing.id))
        .run();

      const updated = db.select().from(notionItems).where(eq(notionItems.id, existing.id)).get();
      return c.json({ ...updated, updated: true }, 200);
    }

    // Insert new item
    const now = new Date().toISOString();
    const item: NewNotionItem = {
      date: body.date!,
      pageId: body.pageId!,
      parentId: body.parentId ?? null,
      parentType: body.parentType as NotionParentType,
      databaseId: body.databaseId ?? null,
      title: body.title!,
      url: body.url!,
      icon: body.icon ?? null,
      properties: body.properties ?? null,
      lastEditedTime: body.lastEditedTime!,
      lastEditedBy: body.lastEditedBy ?? null,
      isRead: body.isRead ?? false,
      priority: body.priority ?? null,
      projectId: body.projectId ?? null,
      syncedAt: now,
      createdAt: now,
    };

    const result = db.insert(notionItems).values(item).returning().get();
    return c.json(result, 201);
  });

  /**
   * POST /api/notion-items/bulk
   * Notion アイテムを一括登録 (MCP からの外部入力用)
   *
   * Body: {
   *   items: Array<{
   *     date: string,
   *     pageId: string,
   *     parentType: "database" | "page" | "workspace",
   *     title: string,
   *     url: string,
   *     lastEditedTime: string,
   *     ... (same as POST /)
   *   }>
   * }
   */
  app.post("/bulk", async (c) => {
    const body = await c.req.json<{ items: Partial<NewNotionItem>[] }>();

    if (!body.items || !Array.isArray(body.items)) {
      return c.json({ error: "items array is required" }, 400);
    }

    if (body.items.length === 0) {
      return c.json({ inserted: 0, updated: 0, errors: [] });
    }

    if (body.items.length > 100) {
      return c.json({ error: "Maximum 100 items per request" }, 400);
    }

    const requiredFields = ["date", "pageId", "parentType", "title", "url", "lastEditedTime"];
    const validParentTypes: NotionParentType[] = ["database", "page", "workspace"];

    const results = {
      inserted: 0,
      updated: 0,
      errors: [] as { index: number; error: string }[],
    };

    const now = new Date().toISOString();

    for (let i = 0; i < body.items.length; i++) {
      const itemData = body.items[i];
      if (!itemData) continue;

      // Validate required fields
      const missingFields = requiredFields.filter((f) => !itemData[f as keyof typeof itemData]);
      if (missingFields.length > 0) {
        results.errors.push({
          index: i,
          error: `Missing required fields: ${missingFields.join(", ")}`,
        });
        continue;
      }

      // Validate parentType
      if (!validParentTypes.includes(itemData.parentType as NotionParentType)) {
        results.errors.push({ index: i, error: `Invalid parentType: ${itemData.parentType}` });
        continue;
      }

      // Validate priority if provided
      if (itemData.priority && !["high", "medium", "low"].includes(itemData.priority)) {
        results.errors.push({ index: i, error: `Invalid priority: ${itemData.priority}` });
        continue;
      }

      // Check for duplicate
      const existing = db
        .select()
        .from(notionItems)
        .where(eq(notionItems.pageId, itemData.pageId!))
        .get();

      if (existing) {
        // Update existing
        db.update(notionItems)
          .set({
            date: itemData.date!,
            parentId: itemData.parentId ?? existing.parentId,
            parentType: itemData.parentType as NotionParentType,
            databaseId: itemData.databaseId ?? existing.databaseId,
            title: itemData.title!,
            url: itemData.url!,
            icon: itemData.icon ?? existing.icon,
            properties: itemData.properties ?? existing.properties,
            lastEditedTime: itemData.lastEditedTime!,
            lastEditedBy: itemData.lastEditedBy ?? existing.lastEditedBy,
            priority: itemData.priority ?? existing.priority,
            projectId: itemData.projectId ?? existing.projectId,
            syncedAt: now,
          })
          .where(eq(notionItems.id, existing.id))
          .run();
        results.updated++;
      } else {
        // Insert new
        const item: NewNotionItem = {
          date: itemData.date!,
          pageId: itemData.pageId!,
          parentId: itemData.parentId ?? null,
          parentType: itemData.parentType as NotionParentType,
          databaseId: itemData.databaseId ?? null,
          title: itemData.title!,
          url: itemData.url!,
          icon: itemData.icon ?? null,
          properties: itemData.properties ?? null,
          lastEditedTime: itemData.lastEditedTime!,
          lastEditedBy: itemData.lastEditedBy ?? null,
          isRead: itemData.isRead ?? false,
          priority: itemData.priority ?? null,
          projectId: itemData.projectId ?? null,
          syncedAt: now,
          createdAt: now,
        };

        db.insert(notionItems).values(item).run();
        results.inserted++;
      }
    }

    return c.json(results);
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
