/**
 * RPC Routes
 *
 * API サーバーからのイベント送信リクエストを受け付け
 */

import type { SSEEmitRequest } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { connectionManager } from "../connections.js";

export function createRPCRouter() {
  const router = new Hono();

  /**
   * POST /rpc/emit
   *
   * イベントを全クライアントにブロードキャスト
   */
  router.post("/emit", async (c) => {
    const body = await c.req.json<SSEEmitRequest>();
    const { event, data } = body;

    if (!event) {
      return c.json({ error: "event is required" }, 400);
    }

    consola.debug(`RPC emit: event=${event}`);

    const result = await connectionManager.broadcast(event, data);

    return c.json({
      ok: true,
      ...result,
    });
  });

  /**
   * GET /rpc/health
   *
   * ヘルスチェック
   */
  router.get("/health", (c) => {
    return c.json({
      status: "ok",
      clients: connectionManager.getClientCount(),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
