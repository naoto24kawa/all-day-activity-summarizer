import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { VocabularySuggestionSourceType } from "@repo/types";
import { and, desc, eq, type SQL } from "drizzle-orm";
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

    // 条件を動的に構築
    const conditions: SQL[] = [];
    if (status) {
      conditions.push(
        eq(schema.vocabularySuggestions.status, status as "pending" | "accepted" | "rejected"),
      );
    }
    if (sourceType) {
      conditions.push(
        eq(schema.vocabularySuggestions.sourceType, sourceType as VocabularySuggestionSourceType),
      );
    }

    const suggestions = db
      .select()
      .from(schema.vocabularySuggestions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.vocabularySuggestions.createdAt))
      .all();

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

  // Notionアイテムから用語抽出
  router.post("/extract/notion", async (c) => {
    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();

    const jobId = enqueueJob(db, "vocabulary-extract", {
      sourceType: "notion",
      date,
      limit: body.limit ?? 50,
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
    for (const sourceType of ["slack", "github", "claude-code", "memo", "notion"] as const) {
      const jobId = enqueueJob(db, "vocabulary-extract", { sourceType, date });
      jobIds.push(jobId);
    }

    return c.json({
      success: true,
      jobIds,
      message: `${jobIds.length}件の用語抽出ジョブをキューに追加しました`,
    });
  });

  // ---------------------------------------------------------------------------
  // 読み設定エンドポイント (非同期キュー)
  // ---------------------------------------------------------------------------

  // 読みがない用語に読みを設定
  router.post("/generate-readings", (c) => {
    const jobId = enqueueJob(db, "vocabulary-generate-readings", {});

    return c.json({
      success: true,
      jobId,
      message: "読み設定ジョブをキューに追加しました",
    });
  });

  // ---------------------------------------------------------------------------
  // 同期エンドポイント (Slack Users, Projects → Vocabulary)
  // ---------------------------------------------------------------------------

  // Slack Users を vocabulary に同期
  router.post("/sync/slack-users", (c) => {
    // Slack メッセージからユニークユーザーを取得
    const usersFromMessages = db
      .select({
        userId: schema.slackMessages.userId,
        userName: schema.slackMessages.userName,
      })
      .from(schema.slackMessages)
      .groupBy(schema.slackMessages.userId)
      .all();

    // slack_users テーブルのマッピングを取得
    const userMappings = db.select().from(schema.slackUsers).all();
    const mappingMap = new Map(userMappings.map((u) => [u.userId, u]));

    // 既存の vocabulary を取得
    const existingTerms = new Set(
      db
        .select({ term: schema.vocabulary.term })
        .from(schema.vocabulary)
        .all()
        .map((v) => v.term.toLowerCase()),
    );

    let addedCount = 0;
    let skippedCount = 0;

    for (const user of usersFromMessages) {
      const mapping = mappingMap.get(user.userId);
      // displayName を優先、なければ slackName/userName
      const name = mapping?.displayName || mapping?.slackName || user.userName;

      if (!name || name.trim() === "") {
        skippedCount++;
        continue;
      }

      const trimmedName = name.trim();

      // 既に登録済みならスキップ
      if (existingTerms.has(trimmedName.toLowerCase())) {
        skippedCount++;
        continue;
      }

      // vocabulary に追加
      db.insert(schema.vocabulary)
        .values({
          term: trimmedName,
          reading: null,
          category: "person",
          source: "manual",
        })
        .run();

      existingTerms.add(trimmedName.toLowerCase());
      addedCount++;
    }

    return c.json({
      success: true,
      added: addedCount,
      skipped: skippedCount,
      message: `${addedCount}件の Slack ユーザーを vocabulary に追加しました`,
    });
  });

  // Projects を vocabulary に同期
  router.post("/sync/projects", (c) => {
    // アクティブなプロジェクトを取得
    const projects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.isActive, true))
      .all();

    // 既存の vocabulary を取得
    const existingTerms = new Set(
      db
        .select({ term: schema.vocabulary.term })
        .from(schema.vocabulary)
        .all()
        .map((v) => v.term.toLowerCase()),
    );

    let addedCount = 0;
    let skippedCount = 0;

    for (const project of projects) {
      const name = project.name?.trim();

      if (!name || name === "") {
        skippedCount++;
        continue;
      }

      // 既に登録済みならスキップ
      if (existingTerms.has(name.toLowerCase())) {
        skippedCount++;
        continue;
      }

      // vocabulary に追加
      db.insert(schema.vocabulary)
        .values({
          term: name,
          reading: null,
          category: "project",
          source: "manual",
        })
        .run();

      existingTerms.add(name.toLowerCase());
      addedCount++;
    }

    return c.json({
      success: true,
      added: addedCount,
      skipped: skippedCount,
      message: `${addedCount}件のプロジェクトを vocabulary に追加しました`,
    });
  });

  return router;
}
