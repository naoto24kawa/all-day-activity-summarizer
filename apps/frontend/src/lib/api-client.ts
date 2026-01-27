import type { AppType } from "@repo/backend";
import { hc } from "hono/client";

/**
 * Hono RPC クライアント
 * バックエンド API を型安全に呼び出すためのクライアント
 *
 * 使用例:
 * ```ts
 * import { apiClient } from "@/lib/api-client";
 *
 * const response = await apiClient.api.config.$get();
 * const data = await response.json();
 * ```
 */
export const apiClient = hc<AppType>(
  // 開発環境: wrangler dev のデフォルトポート
  // 本番環境: 環境変数またはデフォルトで同じオリジン
  import.meta.env.VITE_API_URL || "http://localhost:8787",
);
