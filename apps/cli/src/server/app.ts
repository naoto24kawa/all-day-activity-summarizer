import type { AdasDatabase } from "@repo/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AudioCapture } from "../audio/capture.js";
import type { AdasConfig } from "../config.js";
import { createAIJobsRouter } from "./routes/ai-jobs.js";
import { createAiProcessingLogsRouter } from "./routes/ai-processing-logs.js";
import { createBrowserRecordingRouter } from "./routes/browser-recording.js";
import { createCalendarRouter } from "./routes/calendar.js";
import { createClaudeChatRouter } from "./routes/claude-chat.js";
import { createClaudeCodePathsRouter } from "./routes/claude-code-paths.js";
import { createClaudeCodeSessionsRouter } from "./routes/claude-code-sessions.js";
import { createConfigRouter } from "./routes/config.js";
import { createDLQRouter } from "./routes/dlq.js";
import { createEvaluatorLogsRouter } from "./routes/evaluator-logs.js";
import { createFeedbacksRouter, createSegmentFeedbackRouter } from "./routes/feedbacks.js";
import { createFeedbacksV2Router } from "./routes/feedbacks-v2.js";
import { createGitHubCommentsRouter } from "./routes/github-comments.js";
import { createGitHubItemsRouter } from "./routes/github-items.js";
import { createGitHubReposRouter } from "./routes/github-repos.js";
import { createGmailMessagesRouter } from "./routes/gmail-messages.js";
import { createLearningsRouter } from "./routes/learnings.js";
import { createMemosRouter } from "./routes/memos.js";
import { createNotionDatabasesRouter, createNotionItemsRouter } from "./routes/notion-items.js";
import { createProfileRouter } from "./routes/profile.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createPromptImprovementsRouter } from "./routes/prompt-improvements.js";
import { createRateLimitRouter } from "./routes/rate-limit.js";
import { createRecordingRouter } from "./routes/recording.js";
import { createServerLogsRouter } from "./routes/server-logs.js";
import { createSlackChannelsRouter } from "./routes/slack-channels.js";
import { createSlackMessagesRouter } from "./routes/slack-messages.js";
import { createSlackUsersRouter } from "./routes/slack-users.js";
import { createStatusRouter } from "./routes/status.js";
import { createStorageRouter } from "./routes/storage.js";
import { createSummariesRouter } from "./routes/summaries.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createTranscriptionsRouter } from "./routes/transcriptions.js";
import { createVocabularyRouter } from "./routes/vocabulary.js";

interface CreateAppOptions {
  micCapture?: AudioCapture;
  speakerCapture?: AudioCapture;
  micSource?: string;
  speakerSource?: string;
  config?: AdasConfig;
}

export function createApp(db: AdasDatabase, options?: CreateAppOptions) {
  const app = new Hono();

  app.use("*", cors());

  app.route("/api/transcriptions", createTranscriptionsRouter(db));
  app.route("/api/summaries", createSummariesRouter(db));
  app.route("/api/memos", createMemosRouter(db, options?.config));
  app.route("/api/evaluator-logs", createEvaluatorLogsRouter(db));
  app.route("/api/ai-processing-logs", createAiProcessingLogsRouter(db));
  app.route("/api/feedbacks", createFeedbacksRouter(db));
  app.route("/api/feedbacks/v2", createFeedbacksV2Router(db));
  app.route("/api/segments", createSegmentFeedbackRouter(db));
  app.route("/api/slack-channels", createSlackChannelsRouter(db));
  app.route("/api/slack-messages", createSlackMessagesRouter(db));
  app.route("/api/slack-users", createSlackUsersRouter(db));
  app.route("/api/github-items", createGitHubItemsRouter(db));
  app.route("/api/github-comments", createGitHubCommentsRouter(db));
  app.route("/api/github-repos", createGitHubReposRouter());
  app.route("/api/gmail-messages", createGmailMessagesRouter(db));
  app.route("/api/calendar", createCalendarRouter(db));
  app.route("/api/notion-items", createNotionItemsRouter(db));
  app.route("/api/notion-databases", createNotionDatabasesRouter(db));
  app.route("/api/claude-code-sessions", createClaudeCodeSessionsRouter(db, options?.config));
  app.route("/api/claude-code-paths", createClaudeCodePathsRouter(db));
  app.route("/api/learnings", createLearningsRouter(db, options?.config));
  app.route("/api/server-logs", createServerLogsRouter(options?.config));
  app.route("/api/status", createStatusRouter(db));
  app.route("/api/tasks", createTasksRouter(db));
  app.route("/api/vocabulary", createVocabularyRouter(db, options?.config));
  app.route("/api/prompt-improvements", createPromptImprovementsRouter(db, options?.config));
  app.route("/api/profile", createProfileRouter(db, options?.config));
  app.route("/api/projects", createProjectsRouter(db));
  app.route("/api/config", createConfigRouter());
  app.route("/api/ai-jobs", createAIJobsRouter(db));
  app.route("/api/dlq", createDLQRouter(db));
  app.route("/api/rate-limit", createRateLimitRouter(db));
  app.route("/api/claude-chat", createClaudeChatRouter(db));

  if (options?.micCapture || options?.speakerCapture) {
    app.route(
      "/api/recording",
      createRecordingRouter(
        {
          mic: options.micCapture,
          speaker: options.speakerCapture,
        },
        {
          mic: options.micSource ? { source: options.micSource } : undefined,
          speaker: options.speakerSource ? { source: options.speakerSource } : undefined,
        },
      ),
    );
  } else {
    // serve モードでは録音機能なし - 空のレスポンスを返す
    app.get("/api/recording", (c) => c.json({ mic: null, speaker: null }));
  }

  // Browser recording は常に有効(設定がある場合)
  if (options?.config) {
    app.route("/api/browser-recording", createBrowserRecordingRouter(db, options.config));
    app.route("/api/storage", createStorageRouter(options.config));
  }

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type AppType = ReturnType<typeof createApp>;
