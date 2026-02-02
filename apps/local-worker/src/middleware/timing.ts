import consola from "consola";
import type { Context, Next } from "hono";

/**
 * 処理時間計測ミドルウェア
 * - performance.now() で処理時間を計測
 * - consola.info() でログ出力
 * - X-Response-Time ヘッダーに処理時間を付与
 */
export async function timingMiddleware(c: Context, next: Next) {
  const start = performance.now();

  await next();

  const duration = performance.now() - start;
  const durationMs = duration.toFixed(2);

  // レスポンスヘッダーに処理時間を付与
  c.header("X-Response-Time", `${durationMs}ms`);

  // ログ出力
  const method = c.req.method;
  const path = c.req.path;
  consola.info(`[local-worker/timing] ${method} ${path} - ${durationMs}ms`);
}
