import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { FeedbackRating, FeedbackTargetType } from "@repo/types";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

export function createFeedbacksV2Router(db: AdasDatabase) {
  const router = new Hono();

  // POST /api/feedbacks/v2 - フィードバック登録
  router.post("/", async (c) => {
    const body = await c.req.json<{
      targetType: FeedbackTargetType;
      targetId: number;
      rating: FeedbackRating;
      issues?: string[];
      reason?: string;
      correctedText?: string;
      correctJudgment?: "hallucination" | "legitimate" | "mixed";
    }>();

    // バリデーション
    if (!body.targetType || !["summary", "evaluator_log"].includes(body.targetType)) {
      return c.json({ error: "targetType must be 'summary' or 'evaluator_log'" }, 400);
    }

    if (!body.targetId || typeof body.targetId !== "number") {
      return c.json({ error: "targetId is required and must be a number" }, 400);
    }

    if (!body.rating || !["good", "neutral", "bad"].includes(body.rating)) {
      return c.json({ error: "rating must be 'good', 'neutral', or 'bad'" }, 400);
    }

    // ターゲットの存在確認
    if (body.targetType === "summary") {
      const summary = db
        .select()
        .from(schema.summaries)
        .where(eq(schema.summaries.id, body.targetId))
        .get();
      if (!summary) {
        return c.json({ error: "Summary not found" }, 404);
      }
    } else if (body.targetType === "evaluator_log") {
      const log = db
        .select()
        .from(schema.evaluatorLogs)
        .where(eq(schema.evaluatorLogs.id, body.targetId))
        .get();
      if (!log) {
        return c.json({ error: "Evaluator log not found" }, 404);
      }
    }

    // correctJudgment のバリデーション
    if (
      body.correctJudgment &&
      !["hallucination", "legitimate", "mixed"].includes(body.correctJudgment)
    ) {
      return c.json(
        { error: "correctJudgment must be 'hallucination', 'legitimate', or 'mixed'" },
        400,
      );
    }

    const result = db
      .insert(schema.feedbacks)
      .values({
        targetType: body.targetType,
        targetId: body.targetId,
        rating: body.rating,
        issues: body.issues ? JSON.stringify(body.issues) : null,
        reason: body.reason ?? null,
        correctedText: body.correctedText ?? null,
        correctJudgment: body.correctJudgment ?? null,
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  // GET /api/feedbacks/v2?targetType=summary&date=YYYY-MM-DD
  router.get("/", async (c) => {
    const targetType = c.req.query("targetType") as FeedbackTargetType | undefined;
    const date = c.req.query("date");

    if (!targetType || !["summary", "evaluator_log"].includes(targetType)) {
      return c.json({ error: "targetType query parameter is required" }, 400);
    }

    if (!date) {
      // 日付指定なしの場合は全件取得
      const all = db
        .select()
        .from(schema.feedbacks)
        .where(eq(schema.feedbacks.targetType, targetType))
        .all();
      return c.json(all);
    }

    // 日付でフィルタリング
    if (targetType === "summary") {
      // summaries テーブルと JOIN して日付フィルタ
      const feedbacks = db
        .select({
          id: schema.feedbacks.id,
          targetType: schema.feedbacks.targetType,
          targetId: schema.feedbacks.targetId,
          rating: schema.feedbacks.rating,
          issues: schema.feedbacks.issues,
          reason: schema.feedbacks.reason,
          correctedText: schema.feedbacks.correctedText,
          correctJudgment: schema.feedbacks.correctJudgment,
          createdAt: schema.feedbacks.createdAt,
        })
        .from(schema.feedbacks)
        .innerJoin(schema.summaries, eq(schema.feedbacks.targetId, schema.summaries.id))
        .where(and(eq(schema.feedbacks.targetType, "summary"), eq(schema.summaries.date, date)))
        .all();
      return c.json(feedbacks);
    }

    // evaluator_log の場合
    const feedbacks = db
      .select({
        id: schema.feedbacks.id,
        targetType: schema.feedbacks.targetType,
        targetId: schema.feedbacks.targetId,
        rating: schema.feedbacks.rating,
        issues: schema.feedbacks.issues,
        reason: schema.feedbacks.reason,
        correctedText: schema.feedbacks.correctedText,
        correctJudgment: schema.feedbacks.correctJudgment,
        createdAt: schema.feedbacks.createdAt,
      })
      .from(schema.feedbacks)
      .innerJoin(schema.evaluatorLogs, eq(schema.feedbacks.targetId, schema.evaluatorLogs.id))
      .where(
        and(eq(schema.feedbacks.targetType, "evaluator_log"), eq(schema.evaluatorLogs.date, date)),
      )
      .all();
    return c.json(feedbacks);
  });

  // GET /api/feedbacks/v2/:id - 個別取得
  router.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid feedback ID" }, 400);
    }

    const feedback = db.select().from(schema.feedbacks).where(eq(schema.feedbacks.id, id)).get();

    if (!feedback) {
      return c.json({ error: "Feedback not found" }, 404);
    }

    return c.json(feedback);
  });

  return router;
}
