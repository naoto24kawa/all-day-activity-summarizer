import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { PromptTarget } from "@repo/types";
import { and, desc, eq, or } from "drizzle-orm";

/**
 * フィードバックをプロンプトに動的挿入するための関数群。
 * segment_feedbacks と feedbacks の両方からデータを取得し、
 * few-shot examples としてプロンプトに追加する。
 */

export interface FeedbackExample {
  type: "good" | "bad";
  input: string;
  output: string;
  reason?: string;
  correctedText?: string;
}

/**
 * interpret フィードバックの例を取得
 */
export async function getInterpretFeedbackExamples(
  db: AdasDatabase,
  maxGood = 5,
  maxBad = 3,
): Promise<FeedbackExample[]> {
  // 良いフィードバックを取得
  const goodFeedbacks = db
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
        eq(schema.segmentFeedbacks.rating, "good"),
      ),
    )
    .orderBy(desc(schema.segmentFeedbacks.createdAt))
    .limit(maxGood)
    .all();

  // 悪いフィードバック (修正版テキストがあるもの優先)
  const badFeedbacks = db
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
        eq(schema.segmentFeedbacks.rating, "bad"),
      ),
    )
    .orderBy(desc(schema.segmentFeedbacks.createdAt))
    .limit(maxBad)
    .all();

  const examples: FeedbackExample[] = [];

  for (const fb of goodFeedbacks) {
    if (fb.transcription && fb.interpretedText) {
      examples.push({
        type: "good",
        input: fb.transcription,
        output: fb.interpretedText,
        reason: fb.reason ?? undefined,
      });
    }
  }

  for (const fb of badFeedbacks) {
    if (fb.transcription && fb.interpretedText) {
      examples.push({
        type: "bad",
        input: fb.transcription,
        output: fb.interpretedText,
        reason: fb.reason ?? undefined,
        correctedText: fb.correctedText ?? undefined,
      });
    }
  }

  return examples;
}

/**
 * summarize フィードバックの例を取得 (times/daily 両方)
 */
export async function getSummarizeFeedbackExamples(
  db: AdasDatabase,
  summaryType: "times" | "daily",
  maxGood = 3,
  maxBad = 2,
): Promise<FeedbackExample[]> {
  // feedbacks テーブルから取得
  const goodFeedbacks = db
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
        eq(schema.feedbacks.rating, "good"),
        eq(schema.summaries.summaryType, summaryType),
      ),
    )
    .orderBy(desc(schema.feedbacks.createdAt))
    .limit(maxGood)
    .all();

  const badFeedbacks = db
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
        or(eq(schema.feedbacks.rating, "bad"), eq(schema.feedbacks.rating, "neutral")),
        eq(schema.summaries.summaryType, summaryType),
      ),
    )
    .orderBy(desc(schema.feedbacks.createdAt))
    .limit(maxBad)
    .all();

  const examples: FeedbackExample[] = [];

  for (const fb of goodFeedbacks) {
    if (fb.summaryContent) {
      examples.push({
        type: "good",
        input: "", // サマリーは入力がないので空
        output: fb.summaryContent,
        reason: fb.reason ?? undefined,
      });
    }
  }

  for (const fb of badFeedbacks) {
    if (fb.summaryContent) {
      examples.push({
        type: "bad",
        input: "",
        output: fb.summaryContent,
        reason: fb.reason ?? undefined,
        correctedText: fb.correctedText ?? undefined,
      });
    }
  }

  return examples;
}

/**
 * evaluate フィードバックの例を取得
 */
export async function getEvaluateFeedbackExamples(
  db: AdasDatabase,
  maxGood = 3,
  maxBad = 3,
): Promise<FeedbackExample[]> {
  const goodFeedbacks = db
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
      and(eq(schema.feedbacks.targetType, "evaluator_log"), eq(schema.feedbacks.rating, "good")),
    )
    .orderBy(desc(schema.feedbacks.createdAt))
    .limit(maxGood)
    .all();

  const badFeedbacks = db
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
      and(eq(schema.feedbacks.targetType, "evaluator_log"), eq(schema.feedbacks.rating, "bad")),
    )
    .orderBy(desc(schema.feedbacks.createdAt))
    .limit(maxBad)
    .all();

  const examples: FeedbackExample[] = [];

  for (const fb of goodFeedbacks) {
    examples.push({
      type: "good",
      input: fb.transcriptionText,
      output: `${fb.judgment} (correct)`,
      reason: fb.evaluatorReason,
    });
  }

  for (const fb of badFeedbacks) {
    examples.push({
      type: "bad",
      input: fb.transcriptionText,
      output: `${fb.judgment} (incorrect, should be ${fb.correctJudgment ?? "unknown"})`,
      reason: fb.reason ?? fb.evaluatorReason,
    });
  }

  return examples;
}

/**
 * フィードバック例をフォーマットしてプロンプト用テキストに変換
 */
export function formatFeedbackExamples(examples: FeedbackExample[], target: PromptTarget): string {
  if (examples.length === 0) {
    return "";
  }

  const goodExamples = examples.filter((e) => e.type === "good");
  const badExamples = examples.filter((e) => e.type === "bad");

  let result = "";

  if (goodExamples.length > 0) {
    result += "\n\n## 良い出力例 (参考にしてください)\n";
    for (const ex of goodExamples) {
      if (target === "interpret") {
        result += `\n入力: ${ex.input}\n出力: ${ex.output}\n`;
      } else if (target === "evaluate") {
        result += `\nテキスト: ${ex.input}\n判定: ${ex.output}\n`;
      } else {
        result += `\n出力例:\n${ex.output}\n`;
      }
    }
  }

  if (badExamples.length > 0) {
    result += "\n\n## 避けるべき出力例 (これらの問題を避けてください)\n";
    for (const ex of badExamples) {
      if (target === "interpret") {
        result += `\n入力: ${ex.input}\n問題のある出力: ${ex.output}`;
        if (ex.correctedText) {
          result += `\n修正版: ${ex.correctedText}`;
        }
        if (ex.reason) {
          result += `\n問題点: ${ex.reason}`;
        }
        result += "\n";
      } else if (target === "evaluate") {
        result += `\nテキスト: ${ex.input}\n誤った判定: ${ex.output}`;
        if (ex.reason) {
          result += `\n問題点: ${ex.reason}`;
        }
        result += "\n";
      } else {
        result += `\n問題のある出力:\n${ex.output}`;
        if (ex.correctedText) {
          result += `\n修正版:\n${ex.correctedText}`;
        }
        if (ex.reason) {
          result += `\n問題点: ${ex.reason}`;
        }
        result += "\n";
      }
    }
  }

  return result;
}

/**
 * 指定されたターゲットに対するフィードバック例を取得してプロンプトに挿入可能なテキストを返す
 */
export async function getFeedbackPromptSection(
  db: AdasDatabase,
  target: PromptTarget,
): Promise<string> {
  let examples: FeedbackExample[] = [];

  switch (target) {
    case "interpret":
      examples = await getInterpretFeedbackExamples(db);
      break;
    case "evaluate":
      examples = await getEvaluateFeedbackExamples(db);
      break;
    case "summarize-times":
      examples = await getSummarizeFeedbackExamples(db, "times");
      break;
    case "summarize-daily":
      examples = await getSummarizeFeedbackExamples(db, "daily");
      break;
  }

  return formatFeedbackExamples(examples, target);
}

/**
 * ベースプロンプトにフィードバック例を動的挿入
 */
export async function injectFeedbackExamples(
  basePrompt: string,
  target: PromptTarget,
  db: AdasDatabase,
): Promise<string> {
  const feedbackSection = await getFeedbackPromptSection(db, target);

  if (!feedbackSection) {
    return basePrompt;
  }

  return basePrompt + feedbackSection;
}
