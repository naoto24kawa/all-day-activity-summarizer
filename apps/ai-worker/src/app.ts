import { Hono } from "hono";
import { cors } from "hono/cors";
import { timingMiddleware } from "./middleware/timing.js";
import { createAnalyzeProfileRouter } from "./routes/analyze-profile.js";
import { createCheckCompletionRouter } from "./routes/check-completion.js";
import { createCheckDuplicatesRouter } from "./routes/check-duplicates.js";
import { createEvaluateRouter } from "./routes/evaluate.js";
import { createExplainLearningRouter } from "./routes/explain-learning.js";
import { createExtractLearningsRouter } from "./routes/extract-learnings.js";
import { createExtractTermsRouter } from "./routes/extract-terms.js";
import { createHealthRouter } from "./routes/health.js";
import { createInterpretRouter } from "./routes/interpret.js";
import { createLogsRouter } from "./routes/logs.js";
import { createMatchSlackChannelsRouter } from "./routes/match-slack-channels.js";
import { createSuggestMemoTagsRouter } from "./routes/suggest-memo-tags.js";
import { createSummarizeRouter } from "./routes/summarize.js";

export function createWorkerApp() {
  const app = new Hono();

  app.use("*", cors());
  app.use("/rpc/*", timingMiddleware);

  app.route("/rpc/summarize", createSummarizeRouter());
  app.route("/rpc/evaluate", createEvaluateRouter());
  app.route("/rpc/interpret", createInterpretRouter());
  app.route("/rpc/extract-terms", createExtractTermsRouter());
  app.route("/rpc/extract-learnings", createExtractLearningsRouter());
  app.route("/rpc/explain-learning", createExplainLearningRouter());
  app.route("/rpc/analyze-profile", createAnalyzeProfileRouter());
  app.route("/rpc/check-completion", createCheckCompletionRouter());
  app.route("/rpc/check-duplicates", createCheckDuplicatesRouter());
  app.route("/rpc/suggest-memo-tags", createSuggestMemoTagsRouter());
  app.route("/rpc/match-slack-channels", createMatchSlackChannelsRouter());
  app.route("/rpc/logs", createLogsRouter());
  app.route("/rpc/health", createHealthRouter());

  return app;
}

export type WorkerAppType = ReturnType<typeof createWorkerApp>;
