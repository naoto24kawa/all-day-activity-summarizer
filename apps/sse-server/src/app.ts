/**
 * SSE Server Application
 *
 * 統一 SSE サーバー - 全イベントをブロードキャスト配信
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRPCRouter } from "./routes/rpc.js";
import { createSSERouter } from "./routes/sse.js";

export function createSSEServerApp() {
  const app = new Hono();

  // CORS 設定
  app.use("*", cors());

  // Routes
  app.route("/sse", createSSERouter());
  app.route("/rpc", createRPCRouter());

  return app;
}

export type SSEServerAppType = ReturnType<typeof createSSEServerApp>;
