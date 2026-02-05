/**
 * Restart Route
 *
 * プロセス自身を再起動するエンドポイント
 * トークン認証をサポート
 */

import { Hono } from "hono";

const RESTART_TOKEN = process.env.WORKER_RESTART_TOKEN ?? "";

export function createRestartRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    // トークン認証
    if (RESTART_TOKEN) {
      const authHeader = c.req.header("Authorization");
      const match = authHeader?.match(/^Bearer\s+(.+)$/i);
      if (!match || match[1] !== RESTART_TOKEN) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    // レスポンスを返してから再起動
    setTimeout(() => {
      console.log("[ai-worker] Restarting process...");
      process.exit(0); // 外部プロセスマネージャーが再起動する前提
    }, 100);

    return c.json({ message: "Restarting..." });
  });

  return router;
}
