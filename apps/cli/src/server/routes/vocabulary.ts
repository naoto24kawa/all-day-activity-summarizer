import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { ExtractedTerm, VocabularySuggestionSourceType } from "@repo/types";
import consola from "consola";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AdasConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";

export function createVocabularyRouter(db: AdasDatabase, config?: AdasConfig) {
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
  // 用語抽出エンドポイント
  // ---------------------------------------------------------------------------

  // Slackメッセージから用語抽出
  router.post("/extract/slack", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();
    const limit = body.limit ?? 50;

    // 今日のSlackメッセージを取得
    const messages = db
      .select()
      .from(schema.slackMessages)
      .where(eq(schema.slackMessages.date, date))
      .orderBy(desc(schema.slackMessages.id))
      .limit(limit)
      .all();

    if (messages.length === 0) {
      return c.json({ extracted: 0, message: "No Slack messages found" });
    }

    // テキストを結合
    const combinedText = messages.map((m) => m.text).join("\n\n");

    // 抽出実行
    const result = await extractAndSaveTerms(
      db,
      config,
      combinedText,
      "slack",
      messages[0]?.id ?? null,
      date,
    );

    return c.json(result);
  });

  // GitHubコメントから用語抽出
  router.post("/extract/github", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();
    const limit = body.limit ?? 50;

    // 今日のGitHubコメントを取得
    const comments = db
      .select()
      .from(schema.githubComments)
      .where(eq(schema.githubComments.date, date))
      .orderBy(desc(schema.githubComments.id))
      .limit(limit)
      .all();

    // GitHubアイテム(Issue/PR) のタイトルとBodyも取得
    const items = db
      .select()
      .from(schema.githubItems)
      .where(eq(schema.githubItems.date, date))
      .orderBy(desc(schema.githubItems.id))
      .limit(limit)
      .all();

    const texts: string[] = [];
    for (const item of items) {
      texts.push(`[${item.itemType}] ${item.title}`);
      if (item.body) texts.push(item.body);
    }
    for (const comment of comments) {
      texts.push(comment.body);
    }

    if (texts.length === 0) {
      return c.json({ extracted: 0, message: "No GitHub content found" });
    }

    const combinedText = texts.join("\n\n");

    const result = await extractAndSaveTerms(
      db,
      config,
      combinedText,
      "github",
      items[0]?.id ?? comments[0]?.id ?? null,
      date,
    );

    return c.json(result);
  });

  // Claude Codeセッションから用語抽出
  router.post("/extract/claude-code", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();
    const limit = body.limit ?? 20;

    // 今日のClaude Codeメッセージを取得
    const messages = db
      .select()
      .from(schema.claudeCodeMessages)
      .where(eq(schema.claudeCodeMessages.date, date))
      .orderBy(desc(schema.claudeCodeMessages.id))
      .limit(limit)
      .all();

    if (messages.length === 0) {
      return c.json({ extracted: 0, message: "No Claude Code messages found" });
    }

    // ユーザーメッセージとアシスタントメッセージの両方を含める
    const combinedText = messages
      .map((m) => `[${m.role}]: ${m.content.substring(0, 2000)}`) // 長すぎる場合は切り詰め
      .join("\n\n");

    const result = await extractAndSaveTerms(
      db,
      config,
      combinedText,
      "claude-code",
      messages[0]?.id ?? null,
      date,
    );

    return c.json(result);
  });

  // メモから用語抽出
  router.post("/extract/memo", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string; limit?: number }>();
    const date = body.date ?? getTodayDateString();
    const limit = body.limit ?? 50;

    // 今日のメモを取得
    const memos = db
      .select()
      .from(schema.memos)
      .where(eq(schema.memos.date, date))
      .orderBy(desc(schema.memos.id))
      .limit(limit)
      .all();

    if (memos.length === 0) {
      return c.json({ extracted: 0, message: "No memos found" });
    }

    const combinedText = memos.map((m) => m.content).join("\n\n");

    const result = await extractAndSaveTerms(
      db,
      config,
      combinedText,
      "memo",
      memos[0]?.id ?? null,
      date,
    );

    return c.json(result);
  });

  // 全ソースから用語抽出
  router.post("/extract/all", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();

    const results: Record<string, { extracted: number; message?: string }> = {};

    // 各ソースを順次処理
    for (const source of ["slack", "github", "claude-code", "memo"] as const) {
      try {
        const response = await fetch(
          `http://localhost:${config.server.port}/api/vocabulary/extract/${source}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date }),
          },
        );
        results[source] = await response.json();
      } catch (err) {
        results[source] = {
          extracted: 0,
          message: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
        };
      }
    }

    const totalExtracted = Object.values(results).reduce((sum, r) => sum + (r.extracted ?? 0), 0);

    return c.json({ totalExtracted, results });
  });

  return router;
}

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

interface ExtractTermsResult {
  extracted: number;
  skippedDuplicate: number;
  tasksCreated: number;
}

async function extractAndSaveTerms(
  db: AdasDatabase,
  config: AdasConfig,
  text: string,
  sourceType: VocabularySuggestionSourceType,
  sourceId: number | null,
  date: string,
): Promise<ExtractTermsResult> {
  // 既存の用語を取得 (vocabulary + pending suggestions)
  const existingVocabulary = db
    .select({ term: schema.vocabulary.term })
    .from(schema.vocabulary)
    .all();
  const pendingSuggestions = db
    .select({ term: schema.vocabularySuggestions.term })
    .from(schema.vocabularySuggestions)
    .where(eq(schema.vocabularySuggestions.status, "pending"))
    .all();

  const existingTerms = [
    ...existingVocabulary.map((v) => v.term),
    ...pendingSuggestions.map((s) => s.term),
  ];

  // Worker に抽出リクエスト
  const workerUrl = `${config.worker.url}/rpc/extract-terms`;

  consola.info(
    `[vocabulary/extract] Requesting extraction from ${sourceType} (${text.length} chars)...`,
  );

  const response = await fetch(workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      sourceType,
      existingTerms,
    }),
    signal: AbortSignal.timeout(config.worker.timeout),
  });

  if (!response.ok) {
    throw new Error(`Worker error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as { extractedTerms: ExtractedTerm[] };
  const extractedTerms = result.extractedTerms ?? [];

  consola.info(`[vocabulary/extract] Worker returned ${extractedTerms.length} terms`);

  let extracted = 0;
  let skippedDuplicate = 0;
  let tasksCreated = 0;

  const now = new Date().toISOString();

  for (const term of extractedTerms) {
    // 重複チェック (念のため再確認)
    const isDuplicate = existingTerms.some((t) => t.toLowerCase() === term.term.toLowerCase());
    if (isDuplicate) {
      skippedDuplicate++;
      continue;
    }

    // vocabulary_suggestions に登録
    const suggestion = db
      .insert(schema.vocabularySuggestions)
      .values({
        term: term.term,
        reading: term.reading ?? null,
        category: term.category ?? null,
        reason: term.reason ?? null,
        sourceType,
        sourceId,
        confidence: term.confidence,
        status: "pending",
      })
      .returning()
      .get();

    // tasks に登録
    db.insert(schema.tasks)
      .values({
        date,
        sourceType: "vocabulary",
        vocabularySuggestionId: suggestion.id,
        title: `用語追加: ${term.term}`,
        description: term.reason ?? `${sourceType}から抽出された用語`,
        status: "pending",
        confidence: term.confidence,
        extractedAt: now,
      })
      .run();

    extracted++;
    tasksCreated++;
    existingTerms.push(term.term); // 次の重複チェック用
  }

  consola.info(
    `[vocabulary/extract] Done: ${extracted} extracted, ${skippedDuplicate} skipped, ${tasksCreated} tasks created`,
  );

  return { extracted, skippedDuplicate, tasksCreated };
}
