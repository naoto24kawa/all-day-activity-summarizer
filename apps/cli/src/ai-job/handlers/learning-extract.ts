/**
 * Learning Extract Handler
 *
 * Claude Code セッションから学びを抽出
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { eq } from "drizzle-orm";
import { extractAndSaveLearnings } from "../../claude-code/extractor.js";
import type { AdasConfig } from "../../config.js";
import type { JobResult } from "../worker.js";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleLearningExtract(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const sessionId = params.sessionId as string | undefined;
  const date = params.date as string | undefined;

  if (!sessionId) {
    return {
      success: false,
      resultSummary: "セッションIDが指定されていません",
    };
  }

  // セッション情報を取得
  const session = db
    .select()
    .from(schema.claudeCodeSessions)
    .where(eq(schema.claudeCodeSessions.sessionId, sessionId))
    .get();

  if (!session) {
    return {
      success: false,
      resultSummary: `セッションが見つかりません: ${sessionId}`,
    };
  }

  // セッションのメッセージを取得
  const messages = db
    .select()
    .from(schema.claudeCodeMessages)
    .where(eq(schema.claudeCodeMessages.sessionId, sessionId))
    .all();

  if (messages.length === 0) {
    return {
      success: true,
      resultSummary: "メッセージがないため学びを抽出できません",
      data: { extracted: 0, saved: 0 },
    };
  }

  const result = await extractAndSaveLearnings(
    db,
    config,
    sessionId,
    date ?? session.date,
    messages,
    session.projectName ?? undefined,
    undefined,
    session.projectPath,
  );

  return {
    success: true,
    resultSummary:
      result.saved > 0 ? `${result.saved}件の学びを抽出しました` : "学びは抽出されませんでした",
    data: result,
  };
}
