import type { AdasDatabase } from "@repo/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createStatusRouter } from "./routes/status.js";
import { createSummariesRouter } from "./routes/summaries.js";
import { createTranscriptionsRouter } from "./routes/transcriptions.js";

export function createApp(db: AdasDatabase) {
  const app = new Hono();

  app.use("*", cors());

  app.route("/api/transcriptions", createTranscriptionsRouter(db));
  app.route("/api/summaries", createSummariesRouter(db));
  app.route("/api/status", createStatusRouter(db));

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}

export type AppType = ReturnType<typeof createApp>;
