/**
 * Hono RPC で使用する共通のAPI型定義
 *
 * このファイルでは、フロントエンドとバックエンドで共有する
 * API のペイロード型やレスポンス型を定義します。
 */

/**
 * 汎用APIレスポンス型
 */
export interface ApiResponse<T> {
  data: T;
  timestamp: string;
}

/**
 * APIエラー型
 */
export interface ApiError {
  error: string;
  code: number;
}

/**
 * 例: Post型（テンプレート）
 */
export interface Post {
  id: number;
  title: string;
  body: string;
  createdAt: string;
}
