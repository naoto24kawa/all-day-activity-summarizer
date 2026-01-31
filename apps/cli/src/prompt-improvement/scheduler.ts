/**
 * Prompt Improvement Scheduler
 *
 * プロンプトの定期見直しを自動実行するスケジューラー
 * 1日1回、各プロンプトターゲットのフィードバックを分析し、
 * 改善が必要な場合は改善案を生成する
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { PromptTarget } from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { getTodayDateString } from "../utils/date.js";

const PROMPT_TARGETS: PromptTarget[] = [
  "interpret",
  "evaluate",
  "summarize-times",
  "summarize-daily",
  "task-extract",
];

// 改善提案生成に必要な最小 bad フィードバック数
const MIN_BAD_FEEDBACKS = 3;

// 定期実行の時刻 (6:00)
const SCHEDULED_HOUR = 6;

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

/**
 * フィードバックデータを収集
 */
async function collectFeedbackData(db: AdasDatabase, target: PromptTarget): Promise<FeedbackData> {
  const goodFeedbacks: FeedbackItem[] = [];
  const badFeedbacks: FeedbackItem[] = [];

  // 最終改善日時を取得
  const lastImprovement = db
    .select()
    .from(schema.promptImprovements)
    .where(eq(schema.promptImprovements.target, target))
    .orderBy(desc(schema.promptImprovements.createdAt))
    .limit(1)
    .get();

  const sinceDate = lastImprovement?.createdAt ?? "1970-01-01T00:00:00.000Z";

  if (target === "interpret") {
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
      .where(
        and(
          eq(schema.segmentFeedbacks.target, "interpret"),
          gte(schema.segmentFeedbacks.createdAt, sinceDate),
        ),
      )
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
  } else if (target === "task-extract") {
    // task-extract は tasks テーブルの承認/却下を使用
    const acceptedTasks = db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        slackMessageId: schema.tasks.slackMessageId,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.status, "accepted"),
          isNotNull(schema.tasks.acceptedAt),
          gte(schema.tasks.acceptedAt, sinceDate),
          isNotNull(schema.tasks.slackMessageId),
        ),
      )
      .all();

    const rejectedTasks = db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        slackMessageId: schema.tasks.slackMessageId,
        rejectReason: schema.tasks.rejectReason,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.status, "rejected"),
          isNotNull(schema.tasks.rejectedAt),
          gte(schema.tasks.rejectedAt, sinceDate),
          isNotNull(schema.tasks.slackMessageId),
        ),
      )
      .all();

    // Slack メッセージを取得
    const slackMessageIds = [
      ...acceptedTasks.map((t) => t.slackMessageId),
      ...rejectedTasks.map((t) => t.slackMessageId),
    ].filter((id): id is number => id !== null);

    const slackMessages =
      slackMessageIds.length > 0
        ? db
            .select({ id: schema.slackMessages.id, text: schema.slackMessages.text })
            .from(schema.slackMessages)
            .where(inArray(schema.slackMessages.id, slackMessageIds))
            .all()
        : [];

    const messageMap = new Map(slackMessages.map((m) => [m.id, m.text]));

    for (const task of acceptedTasks) {
      const message = task.slackMessageId ? messageMap.get(task.slackMessageId) : null;
      if (message) {
        goodFeedbacks.push({
          input: message.slice(0, 200),
          output: task.title,
        });
      }
    }

    for (const task of rejectedTasks) {
      const message = task.slackMessageId ? messageMap.get(task.slackMessageId) : null;
      if (message) {
        badFeedbacks.push({
          input: message.slice(0, 200),
          output: task.title,
          reason: task.rejectReason ?? undefined,
        });
      }
    }
  } else if (target.startsWith("summarize-")) {
    const summaryType = target === "summarize-times" ? "times" : "daily";

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
          gte(schema.feedbacks.createdAt, sinceDate),
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
      .where(
        and(
          eq(schema.feedbacks.targetType, "evaluator_log"),
          gte(schema.feedbacks.createdAt, sinceDate),
        ),
      )
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

/**
 * 改善案を生成 (Claude Opus を使用)
 */
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
    model: "opus-4",
    systemPrompt,
    disableTools: true,
  });

  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch?.[1]?.trim() ?? response.trim();
    const parsed = JSON.parse(jsonStr) as { newPrompt: string; reason: string };
    return parsed;
  } catch {
    return {
      newPrompt: currentPrompt,
      reason: "改善案の生成に失敗しました",
    };
  }
}

/**
 * 単一のプロンプトターゲットを処理
 */
async function processTarget(db: AdasDatabase, target: PromptTarget): Promise<boolean> {
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
    consola.debug(`[${target}] Skipped: pending improvement exists`);
    return false;
  }

  // フィードバックを収集
  const feedbackData = await collectFeedbackData(db, target);

  if (feedbackData.badFeedbacks.length < MIN_BAD_FEEDBACKS) {
    consola.debug(
      `[${target}] Skipped: not enough bad feedbacks (${feedbackData.badFeedbacks.length}/${MIN_BAD_FEEDBACKS})`,
    );
    return false;
  }

  // 現在のプロンプトを読み込む
  const currentPrompt = readFileSync(getPromptFilePath(target), "utf-8");

  // 改善案を生成
  consola.start(`[${target}] Generating improvement with Claude Opus...`);
  const improvement = await generateImprovement(target, currentPrompt, feedbackData);

  if (improvement.newPrompt === currentPrompt) {
    consola.warn(`[${target}] No improvement generated`);
    return false;
  }

  // DB に保存
  const today = getTodayDateString();
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
    "summarize-times": "時間範囲サマリ",
    "summarize-daily": "日次サマリ",
    "task-extract": "タスク抽出",
  };

  db.insert(schema.tasks)
    .values({
      date: today,
      promptImprovementId: result.id,
      sourceType: "prompt-improvement",
      title: `${targetLabels[target] || target} を改善`,
      description: `${improvement.reason} (自動生成)`,
      status: "pending",
      priority: "medium",
      confidence: 1.0,
    })
    .run();

  consola.success(`[${target}] Improvement generated and saved (ID: ${result.id})`);
  return true;
}

/**
 * 全プロンプトターゲットを処理
 */
async function processAllTargets(db: AdasDatabase): Promise<void> {
  consola.info("Starting scheduled prompt review...");

  let generatedCount = 0;

  for (const target of PROMPT_TARGETS) {
    try {
      const generated = await processTarget(db, target);
      if (generated) {
        generatedCount++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      consola.error(`[${target}] Error:`, message);
    }
  }

  if (generatedCount > 0) {
    consola.success(`Scheduled prompt review completed: ${generatedCount} improvements generated`);
  } else {
    consola.info("Scheduled prompt review completed: no improvements needed");
  }
}

/**
 * プロンプト改善スケジューラーを開始
 * 毎日指定時刻に実行
 */
export function startPromptImprovementScheduler(db: AdasDatabase): () => void {
  let lastRunDate = "";

  const checkAndRun = async () => {
    const now = new Date();
    const today = getTodayDateString();
    const currentHour = now.getHours();

    // 指定時刻で、かつ今日まだ実行していない場合
    if (currentHour === SCHEDULED_HOUR && lastRunDate !== today) {
      lastRunDate = today;
      await processAllTargets(db);
    }
  };

  consola.info(`Prompt improvement scheduler started (runs daily at ${SCHEDULED_HOUR}:00)`);

  // 初回チェック
  checkAndRun();

  // 1分毎にチェック
  const interval = setInterval(checkAndRun, 60_000);

  return () => clearInterval(interval);
}

/**
 * 手動実行用のエクスポート
 */
export { processAllTargets, processTarget };
