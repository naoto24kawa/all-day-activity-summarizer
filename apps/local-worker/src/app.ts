import { Hono } from "hono";
import { cors } from "hono/cors";
import { timingMiddleware } from "./middleware/timing.js";
import { createHealthRouter } from "./routes/health.js";
import { createTokenizeRouter } from "./routes/tokenize.js";
import { createTranscribeRouter } from "./routes/transcribe.js";

export function createLocalWorkerApp() {
  const app = new Hono();

  app.use("*", cors());
  app.use("/rpc/*", timingMiddleware);

  app.route("/rpc/transcribe", createTranscribeRouter());
  app.route("/rpc/tokenize", createTokenizeRouter());
  app.route("/rpc/health", createHealthRouter());

  return app;
}

export type LocalWorkerAppType = ReturnType<typeof createLocalWorkerApp>;
