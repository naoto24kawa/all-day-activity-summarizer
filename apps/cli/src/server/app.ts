import type { AdasDatabase } from "@repo/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AudioCapture } from "../audio/capture.js";
import { createEvaluatorLogsRouter } from "./routes/evaluator-logs.js";
import { createFeedbacksRouter, createSegmentFeedbackRouter } from "./routes/feedbacks.js";
import { createMemosRouter } from "./routes/memos.js";
import { createRecordingRouter } from "./routes/recording.js";
import { createSpeakersRouter } from "./routes/speakers.js";
import { createStatusRouter } from "./routes/status.js";
import { createSummariesRouter } from "./routes/summaries.js";
import { createTranscriptionsRouter } from "./routes/transcriptions.js";

interface CreateAppOptions {
  capture?: AudioCapture;
}

export function createApp(db: AdasDatabase, options?: CreateAppOptions) {
  const app = new Hono();

  app.use("*", cors());

  app.route("/api/transcriptions", createTranscriptionsRouter(db));
  app.route("/api/summaries", createSummariesRouter(db));
  app.route("/api/memos", createMemosRouter(db));
  app.route("/api/evaluator-logs", createEvaluatorLogsRouter(db));
  app.route("/api/feedbacks", createFeedbacksRouter(db));
  app.route("/api/segments", createSegmentFeedbackRouter(db));
  app.route("/api/speakers", createSpeakersRouter(db));
  app.route("/api/status", createStatusRouter(db));

  if (options?.capture) {
    app.route("/api/recording", createRecordingRouter(options.capture));
  }

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type AppType = ReturnType<typeof createApp>;
