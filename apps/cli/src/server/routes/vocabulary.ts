import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

export function createVocabularyRouter(db: AdasDatabase) {
  const router = new Hono();

  // 全ての用語を取得
  router.get("/", (c) => {
    const terms = db.select().from(schema.vocabulary).all();
    return c.json(terms);
  });

  // 用語を追加
  router.post("/", async (c) => {
    const body = await c.req.json<{
      term: string;
      reading?: string;
      category?: string;
      source?: "manual" | "transcribe" | "feedback";
    }>();

    if (!body.term?.trim()) {
      return c.json({ error: "term is required" }, 400);
    }

    const term = body.term.trim();

    // 既存チェック
    const existing = db
      .select()
      .from(schema.vocabulary)
      .where(eq(schema.vocabulary.term, term))
      .get();

    if (existing) {
      return c.json({ error: "Term already exists", existing }, 409);
    }

    const result = db
      .insert(schema.vocabulary)
      .values({
        term,
        reading: body.reading ?? null,
        category: body.category ?? null,
        source: body.source ?? "manual",
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  // 用語を更新
  router.put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    const body = await c.req.json<{
      term?: string;
      reading?: string | null;
      category?: string | null;
    }>();

    const existing = db.select().from(schema.vocabulary).where(eq(schema.vocabulary.id, id)).get();

    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.term !== undefined) updateData.term = body.term.trim();
    if (body.reading !== undefined) updateData.reading = body.reading;
    if (body.category !== undefined) updateData.category = body.category;

    db.update(schema.vocabulary).set(updateData).where(eq(schema.vocabulary.id, id)).run();

    const updated = db.select().from(schema.vocabulary).where(eq(schema.vocabulary.id, id)).get();

    return c.json(updated);
  });

  // 用語を削除
  router.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    const existing = db.select().from(schema.vocabulary).where(eq(schema.vocabulary.id, id)).get();

    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    db.delete(schema.vocabulary).where(eq(schema.vocabulary.id, id)).run();

    return c.json({ success: true });
  });

  return router;
}
