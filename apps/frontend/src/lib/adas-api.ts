/**
 * ADAS API クライアント
 *
 * フロントエンドから ADAS API (CLI サーバー) にアクセスするためのユーティリティ関数
 */

export const ADAS_API_URL = import.meta.env.VITE_ADAS_API_URL || "http://localhost:3001";

/**
 * ADAS API から GET リクエストでデータを取得する
 */
export async function fetchAdasApi<T>(path: string): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`);
  if (!response.ok) {
    throw new Error(`ADAS API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * ADAS API に POST リクエストを送信する
 */
export async function postAdasApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`ADAS API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * ADAS API に DELETE リクエストを送信する
 */
export async function deleteAdasApi<T>(path: string): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`ADAS API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
