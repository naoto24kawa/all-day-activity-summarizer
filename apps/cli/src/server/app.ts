import type { AdasDatabase } from "@repo/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AudioCapture } from "../audio/capture.js";
import type { AdasConfig } from "../config.js";
import { createBrowserRecordingRouter } from "./routes/browser-recording.js";
import { createClaudeCodeSessionsRouter } from "./routes/claude-code-sessions.js";
import { createEvaluatorLogsRouter } from "./routes/evaluator-logs.js";
import { createFeedbacksRouter, createSegmentFeedbackRouter } from "./routes/feedbacks.js";
import { createFeedbacksV2Router } from "./routes/feedbacks-v2.js";
import { createGitHubCommentsRouter } from "./routes/github-comments.js";
import { createGitHubItemsRouter } from "./routes/github-items.js";
import { createLearningsRouter } from "./routes/learnings.js";
import { createMemosRouter } from "./routes/memos.js";
import { createProfileRouter } from "./routes/profile.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createPromptImprovementsRouter } from "./routes/prompt-improvements.js";
import { createRecordingRouter } from "./routes/recording.js";
import { createServerLogsRouter } from "./routes/server-logs.js";
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
  app.route("/api/memos", createMemosRouter(db));
  app.route("/api/evaluator-logs", createEvaluatorLogsRouter(db));
  app.route("/api/feedbacks", createFeedbacksRouter(db));
  app.route("/api/feedbacks/v2", createFeedbacksV2Router(db));
  app.route("/api/segments", createSegmentFeedbackRouter(db));
  app.route("/api/slack-messages", createSlackMessagesRouter(db));
  app.route("/api/slack-users", createSlackUsersRouter(db));
  app.route("/api/github-items", createGitHubItemsRouter(db));
  app.route("/api/github-comments", createGitHubCommentsRouter(db));
  app.route("/api/claude-code-sessions", createClaudeCodeSessionsRouter(db, options?.config));
  app.route("/api/learnings", createLearningsRouter(db, options?.config));
  app.route("/api/server-logs", createServerLogsRouter(options?.config));
  app.route("/api/status", createStatusRouter(db));
  app.route("/api/tasks", createTasksRouter(db));
  app.route("/api/vocabulary", createVocabularyRouter(db));
  app.route("/api/prompt-improvements", createPromptImprovementsRouter(db));
  app.route("/api/profile", createProfileRouter(db, options?.config));
  app.route("/api/projects", createProjectsRouter(db));

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
