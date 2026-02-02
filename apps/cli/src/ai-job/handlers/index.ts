/**
 * AI Job Handlers Index
 *
 * 全ハンドラーを登録
 */

import { registerJobHandler } from "../worker.js";
import { handleClaudeChat } from "./claude-chat.js";
import { handleLearningExtract } from "./learning-extract.js";
import { handleProfileAnalyze } from "./profile-analyze.js";
import { handleSlackPriority } from "./slack-priority.js";
import { handleSummarizeDaily, handleSummarizeTimes } from "./summarize.js";
import { handleTaskCheckCompletion } from "./task-check-completion.js";
import { handleTaskElaborate } from "./task-elaborate.js";
import {
  handleTaskExtractGitHub,
  handleTaskExtractGitHubComment,
  handleTaskExtractMemo,
  handleTaskExtractSlack,
} from "./task-extract.js";
import { handleVocabularyExtract } from "./vocabulary-extract.js";
import { handleVocabularyGenerateReadings } from "./vocabulary-generate-readings.js";

/**
 * 全ハンドラーを登録
 */
export function registerAllHandlers(): void {
  // タスク抽出
  registerJobHandler("task-extract-slack", handleTaskExtractSlack);
  registerJobHandler("task-extract-github", handleTaskExtractGitHub);
  registerJobHandler("task-extract-github-comment", handleTaskExtractGitHubComment);
  registerJobHandler("task-extract-memo", handleTaskExtractMemo);
  // タスク詳細化
  registerJobHandler("task-elaborate", handleTaskElaborate);
  // タスク完了チェック
  registerJobHandler("task-check-completion", handleTaskCheckCompletion);
  // 学び抽出 (claude-code/transcription/github-comment/slack-message)
  registerJobHandler("learning-extract", handleLearningExtract);
  // 用語抽出 (slack/github/claude-code/memo)
  registerJobHandler("vocabulary-extract", handleVocabularyExtract);
  // 用語読み生成
  registerJobHandler("vocabulary-generate-readings", handleVocabularyGenerateReadings);
  // プロフィール分析
  registerJobHandler("profile-analyze", handleProfileAnalyze);
  // サマリ生成
  registerJobHandler("summarize-times", handleSummarizeTimes);
  registerJobHandler("summarize-daily", handleSummarizeDaily);
  // Claude Chat
  registerJobHandler("claude-chat", handleClaudeChat);
  // Slack 優先度判定
  registerJobHandler("slack-priority", handleSlackPriority);
}
