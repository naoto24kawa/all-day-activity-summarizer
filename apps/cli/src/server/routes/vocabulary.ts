import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { VocabularySuggestionSourceType } from "@repo/types";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import type { AdasConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";

export function createVocabularyRouter(db: AdasDatabase, _config?: AdasConfig) {
  const router = new Hono();

  // 全ての用語を取得
  router.get("/", (c) => {
    const terms = db.select().from(schema.vocabulary).all();
    return c.json(terms);
  });

  // 用語提案一覧を取得
  router.get("/suggestions", (c) => {
    const status = c.req.query("status"); // pending, accepted, rejected
    const sourceType = c.req.query("sourceType");

    let query = db.select().from(schema.vocabularySuggestions);

    if (status) {
      query = query.where(
        eq(schema.vocabularySuggestions.status, status as "pending" | "accepted" | "rejected"),
      );
    }

    if (sourceType) {
      query = query.where(
        eq(schema.vocabularySuggestions.sourceType, sourceType as VocabularySuggestionSourceType),
      );
    }

    const suggestions = query.orderBy(desc(schema.vocabularySuggestions.createdAt)).all();
    return c.json(suggestions);
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

  // ---------------------------------------------------------------------------
  // 用語抽出エンドポイント (非同期キュー)
  // ---------------------------------------------------------------------------

  // Slackメッセージから用語抽出
  router.post("/extract/slack", async (c) => {
    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "vocabulary-extract", {
      sourceType: "slack",
      date,
      limit: body.limit ?? 50,
    });

    return c.json({
      success: true,
      jobId,
      message: "用語抽出ジョブをキューに追加しました",
    });
  });

  // GitHubコメントから用語抽出
  router.post("/extract/github", async (c) => {
    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "vocabulary-extract", {
      sourceType: "github",
      date,
      limit: body.limit ?? 50,
    });

    return c.json({
      success: true,
      jobId,
      message: "用語抽出ジョブをキューに追加しました",
    });
  });

  // Claude Codeセッションから用語抽出
  router.post("/extract/claude-code", async (c) => {
    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "vocabulary-extract", {
      sourceType: "claude-code",
      date,
      limit: body.limit ?? 20,
    });

    return c.json({
      success: true,
      jobId,
      message: "用語抽出ジョブをキューに追加しました",
    });
  });

  // メモから用語抽出
  router.post("/extract/memo", async (c) => {
    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "vocabulary-extract", {
      sourceType: "memo",
      date,
      limit: body.limit ?? 50,
    });

    return c.json({
      success: true,
      jobId,
      message: "用語抽出ジョブをキューに追加しました",
    });
  });

  // 全ソースから用語抽出
  router.post("/extract/all", async (c) => {
    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();

    const jobIds: number[] = [];

    // 各ソースのジョブをキューに追加
    for (const sourceType of ["slack", "github", "claude-code", "memo"] as const) {
      const jobId = enqueueJob(db, "vocabulary-extract", { sourceType, date });
      jobIds.push(jobId);
    }

    return c.json({
      success: true,
      jobIds,
      message: `${jobIds.length}件の用語抽出ジョブをキューに追加しました`,
    });
  });

  return router;
}
