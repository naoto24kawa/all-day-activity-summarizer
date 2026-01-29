import type { LogEntry, LogSource } from "@repo/core";
import { listLogFiles, readLogFile } from "@repo/core";
import { Hono } from "hono";
import type { AdasConfig } from "../../config.js";

/**
 * Worker からログを取得する
 */
async function fetchWorkerLogs(
  workerUrl: string,
  date: string,
  limit: number,
): Promise<{ entries: LogEntry[] }> {
  try {
    const response = await fetch(`${workerUrl}/rpc/logs/worker/${date}?limit=${limit}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { entries: [] };
    }
    return (await response.json()) as { entries: LogEntry[] };
  } catch {
    return { entries: [] };
  }
}

export function createServerLogsRouter(config?: AdasConfig) {
  const app = new Hono();

  /**
   * GET /api/server-logs/files
   * 利用可能なログファイル一覧を取得
   */
  app.get("/files", (c) => {
    const files = listLogFiles();
    return c.json({ files });
  });

  /**
   * GET /api/server-logs/:source/:date
   * 指定されたソースと日付のログを取得
   * - serve: ローカルから読み取り
   * - worker: Worker API から取得
   */
  app.get("/:source/:date", async (c) => {
    const source = c.req.param("source") as LogSource;
    const date = c.req.param("date");
    const limit = Number(c.req.query("limit")) || 500;
    const offset = Number(c.req.query("offset")) || 0;

    if (source !== "serve" && source !== "worker") {
      return c.json({ error: "Invalid source. Must be 'serve' or 'worker'" }, 400);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
    }

    // Worker のログは Worker API から取得
    if (source === "worker" && config?.worker?.url) {
      const result = await fetchWorkerLogs(config.worker.url, date, limit + offset);
      const entries = result.entries.slice(offset, offset + limit);
      return c.json({ entries, source, date, limit, offset });
    }

    // Serve のログはローカルから読み取り
    const entries = readLogFile(source, date, { limit, offset });
    return c.json({ entries, source, date, limit, offset });
  });

  return app;
}
