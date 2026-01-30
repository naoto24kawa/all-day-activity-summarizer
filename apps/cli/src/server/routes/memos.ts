import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getTodayDateString } from "../../utils/date.js";

export function createMemosRouter(db: AdasDatabase) {
  const router = new Hono();

  router.get("/", (c) => {
    const date = c.req.query("date");

    if (!date) {
      const all = db.select().from(schema.memos).all();
      return c.json(all);
    }

    const memos = db.select().from(schema.memos).where(eq(schema.memos.date, date)).all();

    return c.json(memos);
  });

  router.post("/", async (c) => {
    const body = await c.req.json<{ content: string; date?: string; tags?: string[] }>();

    if (!body.content || typeof body.content !== "string" || body.content.trim() === "") {
      return c.json({ error: "content is required" }, 400);
    }

    const date = body.date || getTodayDateString();
    const tags = body.tags && body.tags.length > 0 ? JSON.stringify(body.tags) : null;

    const result = db
      .insert(schema.memos)
      .values({
        date,
        content: body.content.trim(),
        tags,
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  router.put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{ content: string; tags?: string[] | null }>();

    if (!body.content || typeof body.content !== "string" || body.content.trim() === "") {
      return c.json({ error: "content is required" }, 400);
    }

    const existing = db.select().from(schema.memos).where(eq(schema.memos.id, id)).get();
    if (!existing) {
      return c.json({ error: "Memo not found" }, 404);
    }

    const updateData: { content: string; tags?: string | null } = {
      content: body.content.trim(),
    };

    // tags が明示的に渡された場合のみ更新 (undefined なら既存値を維持)
    if (body.tags !== undefined) {
      updateData.tags = body.tags && body.tags.length > 0 ? JSON.stringify(body.tags) : null;
    }

    const result = db
      .update(schema.memos)
      .set(updateData)
      .where(eq(schema.memos.id, id))
      .returning()
      .get();

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

    return c.json({ success: true });
  });

  return router;
}
