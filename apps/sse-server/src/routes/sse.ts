/**
 * SSE Route
 *
 * GET /sse - クライアントが接続し、イベントを受信
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { connectionManager } from "../connections.js";

export function createSSERouter() {
  const router = new Hono();

  router.get("/", async (c) => {
    return streamSSE(c, async (stream) => {
      // クライアント ID を生成
      const clientId = crypto.randomUUID();

      // 接続を登録
      connectionManager.add(clientId, stream);

      // 接続完了イベントを送信
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ clientId }),
      });

      // ハートビート (30秒ごと)
      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({}),
          });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // クリーンアップ
      stream.onAbort(() => {
        clearInterval(heartbeatInterval);
        connectionManager.remove(clientId);
      });

      // 接続維持
      await new Promise(() => {});
    });
  });

  return router;
}
