import { Hono } from "hono";
import { cors } from "hono/cors";
import { createEvaluateRouter } from "./routes/evaluate.js";
import { createHealthRouter } from "./routes/health.js";
import { createInterpretRouter } from "./routes/interpret.js";
import { createSummarizeRouter } from "./routes/summarize.js";
import { createTranscribeRouter } from "./routes/transcribe.js";

export function createWorkerApp() {
  const app = new Hono();

  app.use("*", cors());

  app.route("/rpc/transcribe", createTranscribeRouter());
  app.route("/rpc/summarize", createSummarizeRouter());
  app.route("/rpc/evaluate", createEvaluateRouter());
  app.route("/rpc/interpret", createInterpretRouter());
  app.route("/rpc/health", createHealthRouter());

  return app;
}

export type WorkerAppType = ReturnType<typeof createWorkerApp>;
