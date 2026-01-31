/**
 * AI Job Handlers Index
 *
 * 全ハンドラーを登録
 */

import { registerJobHandler } from "../worker.js";
import { handleLearningExtract } from "./learning-extract.js";
import { handleProfileAnalyze } from "./profile-analyze.js";
import {
  handleTaskExtractGitHub,
  handleTaskExtractGitHubComment,
  handleTaskExtractMemo,
  handleTaskExtractSlack,
} from "./task-extract.js";

/**
 * 全ハンドラーを登録
 */
export function registerAllHandlers(): void {
  registerJobHandler("task-extract-slack", handleTaskExtractSlack);
  registerJobHandler("task-extract-github", handleTaskExtractGitHub);
  registerJobHandler("task-extract-github-comment", handleTaskExtractGitHubComment);
  registerJobHandler("task-extract-memo", handleTaskExtractMemo);
  registerJobHandler("learning-extract", handleLearningExtract);
  registerJobHandler("profile-analyze", handleProfileAnalyze);
}
