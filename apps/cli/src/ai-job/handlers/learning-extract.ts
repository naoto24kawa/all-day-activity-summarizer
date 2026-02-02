/**
 * Learning Extract Handler
 *
 * 各種ソースから学びを抽出
 * - claude-code: Claude Code セッション
 * - transcription: 音声文字起こし
 * - github-comment: GitHub コメント
 * - slack-message: Slack メッセージ
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { LearningSourceType } from "@repo/types";
import { eq, sql } from "drizzle-orm";
import {
  extractAndSaveLearnings,
  extractAndSaveLearningsFromContent,
} from "../../claude-code/extractor.js";
import type { AdasConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";
import { hasExtractionLog } from "../../utils/extraction-log.js";
import { findOrCreateProjectByGitHub } from "../../utils/project-lookup.js";
import type { JobResult } from "../worker.js";

/** 学び抽出ソースタイプ */
type LearningExtractSourceType = Exclude<LearningSourceType, "manual">;

export async function handleLearningExtract(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const sourceType = (params.sourceType as LearningExtractSourceType) ?? "claude-code";
  const date = (params.date as string) ?? getTodayDateString();

  switch (sourceType) {
    case "claude-code":
      return handleClaudeCodeLearningExtract(db, config, params);
    case "transcription":
      return handleTranscriptionLearningExtract(db, config, date, params);
    case "github-comment":
      return handleGitHubCommentLearningExtract(db, config, date);
    case "slack-message":
      return handleSlackMessageLearningExtract(db, config, date);
    default:
      return {
        success: false,
        resultSummary: `不明なソースタイプ: ${sourceType}`,
      };
  }
}

/**
 * Claude Code セッションからの学び抽出
 */
async function handleClaudeCodeLearningExtract(
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

/**
 * 音声文字起こしからの学び抽出
 */
async function handleTranscriptionLearningExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const segmentIds = params.segmentIds as number[] | undefined;

  // 対象セグメントを取得
  let segments: Array<{
    id: number;
    date: string;
    transcription: string;
    interpretedText: string | null;
    speaker: string | null;
  }>;

  if (segmentIds && segmentIds.length > 0) {
    segments = db
      .select({
        id: schema.transcriptionSegments.id,
        date: schema.transcriptionSegments.date,
        transcription: schema.transcriptionSegments.transcription,
        interpretedText: schema.transcriptionSegments.interpretedText,
        speaker: schema.transcriptionSegments.speaker,
      })
      .from(schema.transcriptionSegments)
      .where(sql`${schema.transcriptionSegments.id} IN (${segmentIds.join(",")})`)
      .all();
  } else {
    segments = db
      .select({
        id: schema.transcriptionSegments.id,
        date: schema.transcriptionSegments.date,
        transcription: schema.transcriptionSegments.transcription,
        interpretedText: schema.transcriptionSegments.interpretedText,
        speaker: schema.transcriptionSegments.speaker,
      })
      .from(schema.transcriptionSegments)
      .where(eq(schema.transcriptionSegments.date, date))
      .all();
  }

  if (segments.length === 0) {
    return {
      success: true,
      resultSummary: "対象セグメントがありません",
      data: { extracted: 0, saved: 0 },
    };
  }

  const sourceId = `transcription-${date}`;

  if (hasExtractionLog(db, "learning", "transcription", sourceId)) {
    return {
      success: true,
      resultSummary: "この日付は処理済みです",
      data: { extracted: 0, saved: 0 },
    };
  }

  // メッセージ形式に変換
  const messages = segments.map((s) => ({
    role: s.speaker || "speaker",
    content: s.interpretedText || s.transcription,
  }));

  const result = await extractAndSaveLearningsFromContent(
    db,
    config,
    "transcription",
    sourceId,
    date,
    messages,
    { contextInfo: "音声文字起こしからの学び抽出" },
  );

  return {
    success: true,
    resultSummary:
      result.saved > 0 ? `${result.saved}件の学びを抽出しました` : "学びは抽出されませんでした",
    data: result,
  };
}

/**
 * GitHub コメントからの学び抽出
 */
async function handleGitHubCommentLearningExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
): Promise<JobResult> {
  // GitHub コメントを取得
  const comments = db
    .select()
    .from(schema.githubComments)
    .where(eq(schema.githubComments.date, date))
    .all();

  if (comments.length === 0) {
    return {
      success: true,
      resultSummary: "対象コメントがありません",
      data: { extracted: 0, saved: 0 },
    };
  }

  const sourceId = `github-comment-${date}`;

  if (hasExtractionLog(db, "learning", "github-comment", sourceId)) {
    return {
      success: true,
      resultSummary: "この日付は処理済みです",
      data: { extracted: 0, saved: 0 },
    };
  }

  // メッセージ形式に変換
  const messages = comments.map((c) => ({
    role: c.authorLogin || "reviewer",
    content: `[${c.commentType}] ${c.repoName}#${c.itemNumber}: ${c.body}`,
  }));

  // プロジェクトID を取得
  let projectId: number | null = null;
  const firstComment = comments[0];
  if (firstComment) {
    projectId = findOrCreateProjectByGitHub(db, firstComment.repoOwner, firstComment.repoName);
  }

  const result = await extractAndSaveLearningsFromContent(
    db,
    config,
    "github-comment",
    sourceId,
    date,
    messages,
    { contextInfo: "GitHub PR レビューコメントからの学び抽出", projectId },
  );

  return {
    success: true,
    resultSummary:
      result.saved > 0 ? `${result.saved}件の学びを抽出しました` : "学びは抽出されませんでした",
    data: result,
  };
}

/**
 * Slack メッセージからの学び抽出
 */
async function handleSlackMessageLearningExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
): Promise<JobResult> {
  // Slack メッセージを取得
  const messages = db
    .select()
    .from(schema.slackMessages)
    .where(eq(schema.slackMessages.date, date))
    .all();

  if (messages.length === 0) {
    return {
      success: true,
      resultSummary: "対象メッセージがありません",
      data: { extracted: 0, saved: 0 },
    };
  }

  const sourceId = `slack-message-${date}`;

  if (hasExtractionLog(db, "learning", "slack", sourceId)) {
    return {
      success: true,
      resultSummary: "この日付は処理済みです",
      data: { extracted: 0, saved: 0 },
    };
  }

  // メッセージ形式に変換
  const formattedMessages = messages.map((m) => ({
    role: m.userName || m.userId,
    content: `[${m.channelName || m.channelId}] ${m.text}`,
  }));

  // 最も多いプロジェクト ID を取得
  const projectIds = messages.map((m) => m.projectId).filter((id) => id !== null);
  const projectId = projectIds.length > 0 ? projectIds[0] : null;

  const result = await extractAndSaveLearningsFromContent(
    db,
    config,
    "slack-message",
    sourceId,
    date,
    formattedMessages,
    { contextInfo: "Slack メッセージからの学び抽出", projectId },
  );

  return {
    success: true,
    resultSummary:
      result.saved > 0 ? `${result.saved}件の学びを抽出しました` : "学びは抽出されませんでした",
    data: result,
  };
}
