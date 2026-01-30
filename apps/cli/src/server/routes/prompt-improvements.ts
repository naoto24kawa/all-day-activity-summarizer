/**
 * Prompt Improvements API Routes
 *
 * フィードバックを分析してプロンプト改善案を生成・管理する
 * ユーザー承認方式: 改善案を提示 → ユーザーが承認/却下 → プロンプト更新
 */

import { readFileSync, writeFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { PromptTarget } from "@repo/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

const PROMPT_TARGETS: PromptTarget[] = [
  "interpret",
  "evaluate",
  "summarize-hourly",
  "summarize-daily",
  "task-extract",
];

// 改善提案生成に必要な最小 bad フィードバック数
const MIN_BAD_FEEDBACKS = 3;

export function createPromptImprovementsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/prompt-improvements
   *
   * 改善提案一覧を取得
   * Query params:
   * - status: pending | approved | rejected (optional)
   * - target: interpret | evaluate | summarize-hourly | summarize-daily | task-extract (optional)
   */
  router.get("/", (c) => {
    const status = c.req.query("status") as "pending" | "approved" | "rejected" | undefined;
    const target = c.req.query("target") as PromptTarget | undefined;

    const conditions = [];

    if (status) {
      conditions.push(eq(schema.promptImprovements.status, status));
    }

    if (target) {
      conditions.push(eq(schema.promptImprovements.target, target));
    }

    let query = db
      .select()
      .from(schema.promptImprovements)
      .orderBy(desc(schema.promptImprovements.createdAt));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const improvements = query.all();

    return c.json(improvements);
  });

  /**
   * GET /api/prompt-improvements/stats
   *
   * 各ターゲットの統計情報 (フィードバック数、改善提案数)
   */
  router.get("/stats", (c) => {
    const stats: Record<
      string,
      {
        goodCount: number;
        badCount: number;
        pendingImprovements: number;
        canGenerate: boolean;
      }
    > = {};

    for (const target of PROMPT_TARGETS) {
      // セグメントフィードバック (interpret)
      if (target === "interpret") {
        const feedbacks = db
          .select({
            rating: schema.segmentFeedbacks.rating,
          })
          .from(schema.segmentFeedbacks)
          .where(eq(schema.segmentFeedbacks.target, "interpret"))
          .all();

        const goodCount = feedbacks.filter((f) => f.rating === "good").length;
        const badCount = feedbacks.filter((f) => f.rating === "bad").length;

        const pendingImprovements = db
          .select()
          .from(schema.promptImprovements)
          .where(
            and(
              eq(schema.promptImprovements.target, target),
              eq(schema.promptImprovements.status, "pending"),
            ),
          )
          .all().length;

        stats[target] = {
          goodCount,
          badCount,
          pendingImprovements,
          canGenerate: badCount >= MIN_BAD_FEEDBACKS && pendingImprovements === 0,
        };
      } else {
        // 汎用フィードバック (summarize, evaluate)
        const targetType = target === "evaluate" ? "evaluator_log" : "summary";

        const feedbacks = db
          .select({
            rating: schema.feedbacks.rating,
          })
          .from(schema.feedbacks)
          .where(eq(schema.feedbacks.targetType, targetType))
          .all();

        const goodCount = feedbacks.filter((f) => f.rating === "good").length;
        const badCount = feedbacks.filter(
          (f) => f.rating === "bad" || f.rating === "neutral",
        ).length;

        const pendingImprovements = db
          .select()
          .from(schema.promptImprovements)
          .where(
            and(
              eq(schema.promptImprovements.target, target),
              eq(schema.promptImprovements.status, "pending"),
            ),
          )
          .all().length;

        stats[target] = {
          goodCount,
          badCount,
          pendingImprovements,
          canGenerate: badCount >= MIN_BAD_FEEDBACKS && pendingImprovements === 0,
        };
      }
    }

    return c.json(stats);
  });

  /**
   * POST /api/prompt-improvements/generate
   *
   * フィードバックを分析してプロンプト改善案を生成
   * Body: { target: PromptTarget }
   */
  router.post("/generate", async (c) => {
    const body = await c.req.json<{ target: PromptTarget }>();
    const { target } = body;

    if (!PROMPT_TARGETS.includes(target)) {
      return c.json({ error: "Invalid target" }, 400);
    }

    // 既存の pending 改善案があるかチェック
    const existingPending = db
      .select()
      .from(schema.promptImprovements)
      .where(
        and(
          eq(schema.promptImprovements.target, target),
          eq(schema.promptImprovements.status, "pending"),
        ),
      )
      .get();

    if (existingPending) {
      return c.json(
        { error: "既に承認待ちの改善案があります。先に承認または却下してください。" },
        400,
      );
    }

    // フィードバックを取得
    const feedbackData = await collectFeedbackData(db, target);

    if (feedbackData.badFeedbacks.length < MIN_BAD_FEEDBACKS) {
      return c.json(
        {
          error: `改善案生成には最低 ${MIN_BAD_FEEDBACKS} 件の悪いフィードバックが必要です (現在: ${feedbackData.badFeedbacks.length} 件)`,
        },
        400,
      );
    }

    // 現在のプロンプトを読み込む
    const currentPrompt = readFileSync(getPromptFilePath(target), "utf-8");

    // AI で改善案を生成
    const improvement = await generateImprovement(target, currentPrompt, feedbackData);

    // DB に保存 (prompt_improvements)
    const result = db
      .insert(schema.promptImprovements)
      .values({
        target,
        previousPrompt: currentPrompt,
        newPrompt: improvement.newPrompt,
        feedbackCount: feedbackData.goodFeedbacks.length + feedbackData.badFeedbacks.length,
        goodCount: feedbackData.goodFeedbacks.length,
        badCount: feedbackData.badFeedbacks.length,
        improvementReason: improvement.reason,
        status: "pending",
      })
      .returning()
      .get();

    // tasks テーブルにも登録
    const targetLabels: Record<string, string> = {
      interpret: "AI 解釈",
      evaluate: "ハルシネーション評価",
      "summarize-hourly": "時間帯別サマリ",
      "summarize-daily": "日次サマリ",
      "task-extract": "タスク抽出",
    };
    const today = new Date().toISOString().split("T")[0];
    db.insert(schema.tasks)
      .values({
        date: today!,
        promptImprovementId: result.id,
        sourceType: "prompt-improvement",
        title: `[改善] ${targetLabels[target] || target} プロンプトを改善`,
        description: improvement.reason,
        status: "pending",
        priority: "medium",
        confidence: 1.0,
      })
      .run();

    return c.json(result);
  });

  /**
   * GET /api/prompt-improvements/:id
   */
  router.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const improvement = db
      .select()
      .from(schema.promptImprovements)
      .where(eq(schema.promptImprovements.id, id))
      .get();

    if (!improvement) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json(improvement);
  });

  /**
   * POST /api/prompt-improvements/:id/approve
   *
   * 改善案を承認してプロンプトファイルを更新
   */
  router.post("/:id/approve", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const improvement = db
      .select()
      .from(schema.promptImprovements)
      .where(eq(schema.promptImprovements.id, id))
      .get();

    if (!improvement) {
      return c.json({ error: "Not found" }, 404);
    }

    if (improvement.status !== "pending") {
      return c.json({ error: `既に ${improvement.status} です` }, 400);
    }

    // プロンプトファイルを更新
    const promptPath = getPromptFilePath(improvement.target as PromptTarget);
    writeFileSync(promptPath, improvement.newPrompt, "utf-8");

    const now = new Date().toISOString();

    // ステータスを更新 (prompt_improvements)
    const result = db
      .update(schema.promptImprovements)
      .set({
        status: "approved",
        approvedAt: now,
      })
      .where(eq(schema.promptImprovements.id, id))
      .returning()
      .get();

    // tasks テーブルも更新
    db.update(schema.tasks)
      .set({
        status: "completed",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tasks.promptImprovementId, id))
      .run();

    return c.json(result);
  });

  /**
   * POST /api/prompt-improvements/:id/reject
   *
   * 改善案を却下
   */
  router.post("/:id/reject", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const improvement = db
      .select()
      .from(schema.promptImprovements)
      .where(eq(schema.promptImprovements.id, id))
      .get();

    if (!improvement) {
      return c.json({ error: "Not found" }, 404);
    }

    if (improvement.status !== "pending") {
      return c.json({ error: `既に ${improvement.status} です` }, 400);
    }

    const now = new Date().toISOString();

    // ステータスを更新 (prompt_improvements)
    const result = db
      .update(schema.promptImprovements)
      .set({
        status: "rejected",
        rejectedAt: now,
      })
      .where(eq(schema.promptImprovements.id, id))
      .returning()
      .get();

    // tasks テーブルも更新
    db.update(schema.tasks)
      .set({
        status: "rejected",
        rejectedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tasks.promptImprovementId, id))
      .run();

    return c.json(result);
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

interface FeedbackItem {
  input: string;
  output: string;
  reason?: string;
  correctedText?: string;
}

interface FeedbackData {
  goodFeedbacks: FeedbackItem[];
  badFeedbacks: FeedbackItem[];
}

async function collectFeedbackData(db: AdasDatabase, target: PromptTarget): Promise<FeedbackData> {
  const goodFeedbacks: FeedbackItem[] = [];
  const badFeedbacks: FeedbackItem[] = [];

  if (target === "interpret") {
    // interpret フィードバック
    const feedbacks = db
      .select({
        rating: schema.segmentFeedbacks.rating,
        reason: schema.segmentFeedbacks.reason,
        correctedText: schema.segmentFeedbacks.correctedText,
        transcription: schema.transcriptionSegments.transcription,
        interpretedText: schema.transcriptionSegments.interpretedText,
      })
      .from(schema.segmentFeedbacks)
      .innerJoin(
        schema.transcriptionSegments,
        eq(schema.segmentFeedbacks.segmentId, schema.transcriptionSegments.id),
      )
      .where(eq(schema.segmentFeedbacks.target, "interpret"))
      .orderBy(desc(schema.segmentFeedbacks.createdAt))
      .limit(20)
      .all();

    for (const fb of feedbacks) {
      if (!fb.transcription || !fb.interpretedText) continue;

      const item: FeedbackItem = {
        input: fb.transcription,
        output: fb.interpretedText,
        reason: fb.reason ?? undefined,
        correctedText: fb.correctedText ?? undefined,
      };

      if (fb.rating === "good") {
        goodFeedbacks.push(item);
      } else {
        badFeedbacks.push(item);
      }
    }
  } else if (target.startsWith("summarize-")) {
    const summaryType = target === "summarize-hourly" ? "hourly" : "daily";

    const feedbacks = db
      .select({
        rating: schema.feedbacks.rating,
        reason: schema.feedbacks.reason,
        correctedText: schema.feedbacks.correctedText,
        summaryContent: schema.summaries.content,
      })
      .from(schema.feedbacks)
      .innerJoin(schema.summaries, eq(schema.feedbacks.targetId, schema.summaries.id))
      .where(
        and(
          eq(schema.feedbacks.targetType, "summary"),
          eq(schema.summaries.summaryType, summaryType),
        ),
      )
      .orderBy(desc(schema.feedbacks.createdAt))
      .limit(20)
      .all();

    for (const fb of feedbacks) {
      if (!fb.summaryContent) continue;

      const item: FeedbackItem = {
        input: "",
        output: fb.summaryContent,
        reason: fb.reason ?? undefined,
        correctedText: fb.correctedText ?? undefined,
      };

      if (fb.rating === "good") {
        goodFeedbacks.push(item);
      } else {
        badFeedbacks.push(item);
      }
    }
  } else if (target === "evaluate") {
    const feedbacks = db
      .select({
        rating: schema.feedbacks.rating,
        reason: schema.feedbacks.reason,
        correctJudgment: schema.feedbacks.correctJudgment,
        transcriptionText: schema.evaluatorLogs.transcriptionText,
        judgment: schema.evaluatorLogs.judgment,
        evaluatorReason: schema.evaluatorLogs.reason,
      })
      .from(schema.feedbacks)
      .innerJoin(schema.evaluatorLogs, eq(schema.feedbacks.targetId, schema.evaluatorLogs.id))
      .where(eq(schema.feedbacks.targetType, "evaluator_log"))
      .orderBy(desc(schema.feedbacks.createdAt))
      .limit(20)
      .all();

    for (const fb of feedbacks) {
      const item: FeedbackItem = {
        input: fb.transcriptionText,
        output: `${fb.judgment}`,
        reason: fb.reason ?? fb.evaluatorReason,
        correctedText: fb.correctJudgment ?? undefined,
      };

      if (fb.rating === "good") {
        goodFeedbacks.push(item);
      } else {
        badFeedbacks.push(item);
      }
    }
  }

  return { goodFeedbacks, badFeedbacks };
}

async function generateImprovement(
  target: PromptTarget,
  currentPrompt: string,
  feedbackData: FeedbackData,
): Promise<{ newPrompt: string; reason: string }> {
  const systemPrompt = `あなたはプロンプトエンジニアです。
フィードバックデータを分析して、プロンプトを改善してください。

## ルール
1. 現在のプロンプトの構造は維持しつつ、問題点を改善する
2. 悪いフィードバックのパターンを分析し、それを防ぐ指示を追加する
3. 良いフィードバックのパターンを強化する指示を追加する
4. 改善は控えめに、必要最小限の変更にとどめる
5. 日本語で記述する

## 出力形式
以下の JSON 形式で出力してください:
\`\`\`json
{
  "newPrompt": "改善後のプロンプト全文",
  "reason": "改善の理由 (50文字以内)"
}
\`\`\``;

  const userPrompt = `## 対象: ${target}

## 現在のプロンプト
${currentPrompt}

## 良いフィードバック (${feedbackData.goodFeedbacks.length}件)
${feedbackData.goodFeedbacks
  .slice(0, 5)
  .map(
    (f) => `- 入力: ${f.input.slice(0, 100)}
  出力: ${f.output.slice(0, 100)}`,
  )
  .join("\n")}

## 悪いフィードバック (${feedbackData.badFeedbacks.length}件)
${feedbackData.badFeedbacks
  .map(
    (f) => `- 入力: ${f.input.slice(0, 100)}
  問題の出力: ${f.output.slice(0, 100)}
  ${f.reason ? `問題点: ${f.reason}` : ""}
  ${f.correctedText ? `修正版: ${f.correctedText.slice(0, 100)}` : ""}`,
  )
  .join("\n")}

上記のフィードバックを分析し、プロンプトを改善してください。`;

  const response = await runClaude(userPrompt, {
    model: "sonnet",
    systemPrompt,
    disableTools: true,
  });

  // JSON をパース
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    const parsed = JSON.parse(jsonStr) as { newPrompt: string; reason: string };
    return parsed;
  } catch {
    // パース失敗時はそのまま返す
    return {
      newPrompt: currentPrompt,
      reason: "改善案の生成に失敗しました",
    };
  }
}
