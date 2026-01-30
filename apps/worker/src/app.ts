import { Hono } from "hono";
import { cors } from "hono/cors";
import { timingMiddleware } from "./middleware/timing.js";
import { createEvaluateRouter } from "./routes/evaluate.js";
import { createExtractLearningsRouter } from "./routes/extract-learnings.js";
import { createHealthRouter } from "./routes/health.js";
import { createInterpretRouter } from "./routes/interpret.js";
import { createLogsRouter } from "./routes/logs.js";
import { createSummarizeRouter } from "./routes/summarize.js";
import { createTranscribeRouter } from "./routes/transcribe.js";

export function createWorkerApp() {
  const app = new Hono();

  app.use("*", cors());
  app.use("/rpc/*", timingMiddleware);

  app.route("/rpc/transcribe", createTranscribeRouter());
  app.route("/rpc/summarize", createSummarizeRouter());
  app.route("/rpc/evaluate", createEvaluateRouter());
  app.route("/rpc/interpret", createInterpretRouter());
  app.route("/rpc/extract-learnings", createExtractLearningsRouter());
  app.route("/rpc/logs", createLogsRouter());
  app.route("/rpc/health", createHealthRouter());

  return app;
}

export type WorkerAppType = ReturnType<typeof createWorkerApp>;
