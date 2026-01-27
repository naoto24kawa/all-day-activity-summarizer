import type { Env } from "@repo/types/env";
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: Env }>();

// CORS設定（開発環境でフロントエンドからのリクエストを許可）
app.use("/*", cors());

// ヘルスチェック用エンドポイント
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// 環境変数を取得してSPAに渡すAPIエンドポイント
app.get("/api/config", (c) => {
  // c.envから環境変数を取得
  const appName = c.env.APP_NAME || "Hono + React App";
  const appVersion = c.env.APP_VERSION || "1.0.0";
  const apiEndpoint = c.env.API_ENDPOINT || "http://localhost:8787";

  return c.json({
    appName,
    appVersion,
    apiEndpoint,
    timestamp: new Date().toISOString(),
  });
});

// シンプルなGETエンドポイント例
app.get("/api/hello", (c) => {
  const name = c.req.query("name") || "World";
  return c.json({
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
  });
});

// AppType を export（Hono RPC用）
export type AppType = typeof app;

// Cloudflare Workers用エクスポート
export default app;
