import type { LogSource } from "@repo/core";
import { listLogFiles, readLogFile } from "@repo/core";
import { Hono } from "hono";

const app = new Hono();

/**
 * GET /rpc/logs/files
 * 利用可能なログファイル一覧を取得
 */
app.get("/files", (c) => {
  const files = listLogFiles();
  return c.json({ files });
});

/**
 * GET /rpc/logs/:source/:date
 * 指定されたソースと日付のログを取得
 */
app.get("/:source/:date", (c) => {
  const source = c.req.param("source") as LogSource;
  const date = c.req.param("date");
  const limit = Number(c.req.query("limit")) || 500;
  const offset = Number(c.req.query("offset")) || 0;

  const validSources: LogSource[] = [
    "serve",
    "worker",
    "ai-worker",
    "local-worker",
    "servers",
    "sse-server",
  ];
  if (!validSources.includes(source)) {
    return c.json({ error: `Invalid source. Must be one of: ${validSources.join(", ")}` }, 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
  }

  const entries = readLogFile(source, date, { limit, offset });
  return c.json({ entries, source, date, limit, offset });
});

export function createLogsRouter() {
  return app;
}
