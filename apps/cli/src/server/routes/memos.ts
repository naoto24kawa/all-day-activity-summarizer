import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueTaskExtractIfEnabled } from "../../ai-job/auto-task-extract.js";
import type { AdasConfig } from "../../config.js";
import { suggestMemoTags } from "../../memo/tag-suggester.js";
import { getTodayDateString } from "../../utils/date.js";
import { findProjectFromContent } from "../../utils/project-lookup.js";

export function createMemosRouter(db: AdasDatabase, config?: AdasConfig) {
  const router = new Hono();

  /**
   * GET /api/memos
   *
   * Returns memos with pagination support.
   * Query params:
   * - limit: number (optional, defaults to 50)
   * - offset: number (optional, defaults to 0)
   *
   * Response:
   * - memos: Memo[] (ordered by createdAt descending - newest first)
   * - total: number (total count of memos)
   * - hasMore: boolean (true if there are more memos to fetch)
   */
  router.get("/", (c) => {
    const limitStr = c.req.query("limit");
    const offsetStr = c.req.query("offset");
    const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
    const offset = offsetStr ? Number.parseInt(offsetStr, 10) : 0;

    // Get total count
    const totalResult = db.select({ count: count() }).from(schema.memos).get();
    const total = totalResult?.count ?? 0;

    // Get paginated memos
    const memos = db
      .select()
      .from(schema.memos)
      .orderBy(desc(schema.memos.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    const hasMore = offset + memos.length < total;

    return c.json({ memos, total, hasMore });
  });

  router.post("/", async (c) => {
    const body = await c.req.json<{
      content: string;
      date?: string;
      tags?: string[];
      projectId?: number | null;
    }>();

    if (!body.content || typeof body.content !== "string" || body.content.trim() === "") {
      return c.json({ error: "content is required" }, 400);
    }

    const date = body.date || getTodayDateString();

    // Auto-suggest tags if not specified
    let tags: string | null = null;
    if (body.tags && body.tags.length > 0) {
      tags = JSON.stringify(body.tags);
    } else {
      // AI auto-tagging
      const suggestedTags = await suggestMemoTags(body.content.trim());
      if (suggestedTags.length > 0) {
        tags = JSON.stringify(suggestedTags);
      }
    }

    // Auto-link project if not specified
    let projectId = body.projectId ?? null;
    if (projectId === null) {
      projectId = findProjectFromContent(db, body.content);
    }

    const result = db
      .insert(schema.memos)
      .values({
        date,
        content: body.content.trim(),
        tags,
        projectId,
      })
      .returning()
      .get();

    if (config) {
      enqueueTaskExtractIfEnabled(db, config, "memo", { date: result.date });
    }

    return c.json(result, 201);
  });

  router.put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{
      content: string;
      tags?: string[] | null;
      projectId?: number | null;
    }>();

    if (!body.content || typeof body.content !== "string" || body.content.trim() === "") {
      return c.json({ error: "content is required" }, 400);
    }

    const existing = db.select().from(schema.memos).where(eq(schema.memos.id, id)).get();
    if (!existing) {
      return c.json({ error: "Memo not found" }, 404);
    }

    const updateData: { content: string; tags?: string | null; projectId?: number | null } = {
      content: body.content.trim(),
    };

    // tags が明示的に渡された場合のみ更新 (undefined なら既存値を維持)
    if (body.tags !== undefined) {
      updateData.tags = body.tags && body.tags.length > 0 ? JSON.stringify(body.tags) : null;
    } else if (!existing.tags) {
      // tags が未指定かつ既存タグがない場合のみ AI 自動付与
      const suggestedTags = await suggestMemoTags(body.content.trim());
      if (suggestedTags.length > 0) {
        updateData.tags = JSON.stringify(suggestedTags);
      }
    }

    // projectId が明示的に渡された場合のみ更新
    if (body.projectId !== undefined) {
      updateData.projectId = body.projectId;
    }

    const result = db
      .update(schema.memos)
      .set(updateData)
      .where(eq(schema.memos.id, id))
      .returning()
      .get();

    if (config) {
      enqueueTaskExtractIfEnabled(db, config, "memo", { date: result.date });
    }

    return c.json(result);
  });

  router.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.memos).where(eq(schema.memos.id, id)).get();
    if (!existing) {
      return c.json({ error: "Memo not found" }, 404);
    }

    db.delete(schema.memos).where(eq(schema.memos.id, id)).run();

    return c.json({ deleted: true });
  });

  return router;
}
