import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

export function createFeedbacksRouter(db: AdasDatabase) {
  const router = new Hono();

  // GET /api/feedbacks?date=YYYY-MM-DD
  router.get("/", (c) => {
    const date = c.req.query("date");

    if (!date) {
      const all = db.select().from(schema.segmentFeedbacks).all();
      return c.json(all);
    }

    // segment_feedbacks にはdateがないので、segmentのdateでフィルタする
    const feedbacks = db
      .select({
        id: schema.segmentFeedbacks.id,
        segmentId: schema.segmentFeedbacks.segmentId,
        rating: schema.segmentFeedbacks.rating,
        target: schema.segmentFeedbacks.target,
        reason: schema.segmentFeedbacks.reason,
        issues: schema.segmentFeedbacks.issues,
        correctedText: schema.segmentFeedbacks.correctedText,
        createdAt: schema.segmentFeedbacks.createdAt,
      })
      .from(schema.segmentFeedbacks)
      .innerJoin(
        schema.transcriptionSegments,
        eq(schema.segmentFeedbacks.segmentId, schema.transcriptionSegments.id),
      )
      .where(eq(schema.transcriptionSegments.date, date))
      .all();

    return c.json(feedbacks);
  });

  return router;
}

export function createSegmentFeedbackRouter(db: AdasDatabase) {
  const router = new Hono();

  // POST /api/segments/:id/feedback
  router.post("/:id/feedback", async (c) => {
    const segmentId = Number(c.req.param("id"));

    if (Number.isNaN(segmentId)) {
      return c.json({ error: "Invalid segment ID" }, 400);
    }

    const body = await c.req.json<{
      rating: string;
      target?: string;
      reason?: string;
      issues?: string[];
      correctedText?: string;
    }>();

    if (!body.rating || (body.rating !== "good" && body.rating !== "bad")) {
      return c.json({ error: "rating must be 'good' or 'bad'" }, 400);
    }

    const validTargets = ["interpret", "evaluate", "summarize-hourly", "summarize-daily"] as const;
    const target = body.target ?? "interpret";
    if (!validTargets.includes(target as (typeof validTargets)[number])) {
      return c.json({ error: `target must be one of: ${validTargets.join(", ")}` }, 400);
    }

    // セグメントの存在確認
    const segment = db
      .select()
      .from(schema.transcriptionSegments)
      .where(eq(schema.transcriptionSegments.id, segmentId))
      .get();

    if (!segment) {
      return c.json({ error: "Segment not found" }, 404);
    }

    const result = db
      .insert(schema.segmentFeedbacks)
      .values({
        segmentId,
        rating: body.rating as "good" | "bad",
        target: target as (typeof validTargets)[number],
        reason: body.reason ?? null,
        issues: body.issues ? JSON.stringify(body.issues) : null,
        correctedText: body.correctedText ?? null,
      })
      .returning()
      .get();

    // bad フィードバックで correctedText がある場合、vocabulary へ自動登録を試みる
    if (body.rating === "bad" && body.correctedText) {
      extractAndRegisterTerms(db, body.correctedText, segment.transcription);
    }

    return c.json(result, 201);
  });

  return router;
}

/**
 * correctedText から固有名詞・専門用語を抽出し vocabulary に登録する。
 * 差分ベース: 元のテキストになかった単語を候補とする。
 */
function extractAndRegisterTerms(
  db: AdasDatabase,
  correctedText: string,
  originalText: string,
): void {
  // 単語分割(簡易的なアプローチ: カタカナ/英字の連続を抽出)
  const extractWords = (text: string): Set<string> => {
    const words = new Set<string>();

    // カタカナ語 (3文字以上)
    const katakana = text.match(/[\u30A0-\u30FF]{3,}/g) ?? [];
    for (const w of katakana) words.add(w);

    // 英語 (3文字以上)
    const english = text.match(/[A-Za-z]{3,}/gi) ?? [];
    for (const w of english) words.add(w);

    // 英語+数字の組み合わせ (バージョン番号など)
    const alphanumeric = text.match(/[A-Za-z]+[\d.]+[A-Za-z\d.]*/gi) ?? [];
    for (const w of alphanumeric) words.add(w);

    return words;
  };

  const originalWords = extractWords(originalText);
  const correctedWords = extractWords(correctedText);

  // 修正後にのみ存在する単語を抽出
  const newTerms: string[] = [];
  for (const word of correctedWords) {
    // 元のテキストに含まれていない
    if (!originalWords.has(word) && !originalText.toLowerCase().includes(word.toLowerCase())) {
      newTerms.push(word);
    }
  }

  if (newTerms.length === 0) return;

  let added = 0;
  for (const term of newTerms) {
    // 既存チェック
    const existing = db
      .select()
      .from(schema.vocabulary)
      .where(eq(schema.vocabulary.term, term))
      .get();

    if (existing) continue;

    try {
      db.insert(schema.vocabulary)
        .values({
          term,
          reading: null,
          category: null,
          source: "feedback",
        })
        .run();
      added++;
    } catch {
      // 重複エラーは無視
    }
  }

  if (added > 0) {
    consola.info(
      `[vocabulary] Auto-registered ${added} term(s) from feedback: ${newTerms.slice(0, 5).join(", ")}`,
    );
  }
}
