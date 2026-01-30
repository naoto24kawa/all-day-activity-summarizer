/**
 * ADAS API クライアント
 *
 * フロントエンドから ADAS API (CLI サーバー) にアクセスするためのユーティリティ関数
 */

export const ADAS_API_URL = import.meta.env.VITE_ADAS_API_URL || "http://localhost:3001";

/**
 * API エラーレスポンスの型
 */
interface ApiErrorResponse {
  error?: string;
  message?: string;
  details?: {
    feature?: string;
    featureName?: string;
    hint?: string;
  };
}

/**
 * レスポンスからユーザーフレンドリーなエラーメッセージを取得する
 */
async function getErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ApiErrorResponse;
    if (data.message) {
      // 詳細なエラーメッセージがある場合
      if (data.details?.hint) {
        return `${data.message} (${data.details.hint})`;
      }
      return data.message;
    }
    if (data.error) {
      return data.error;
    }
  } catch {
    // JSON パースに失敗した場合はデフォルトメッセージを使用
  }
  return `API error: ${response.status} ${response.statusText}`;
}

/**
 * ADAS API から GET リクエストでデータを取得する
 */
export async function fetchAdasApi<T>(path: string): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`);
  if (!response.ok) {
    const errorMessage = await getErrorMessage(response);
    throw new Error(errorMessage);
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
    const errorMessage = await getErrorMessage(response);
    throw new Error(errorMessage);
  }
  return response.json() as Promise<T>;
}

/**
 * ADAS API に PUT リクエストを送信する
 */
export async function putAdasApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorMessage = await getErrorMessage(response);
    throw new Error(errorMessage);
  }
  return response.json() as Promise<T>;
}

/**
 * ADAS API に PATCH リクエストを送信する
 */
export async function patchAdasApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorMessage = await getErrorMessage(response);
    throw new Error(errorMessage);
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
    const errorMessage = await getErrorMessage(response);
    throw new Error(errorMessage);
  }
  return response.json() as Promise<T>;
}

/**
 * ADAS API に FormData (multipart/form-data) で POST リクエストを送信する
 */
export async function postFormDataAdasApi<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const errorMessage = await getErrorMessage(response);
    throw new Error(errorMessage);
  }
  return response.json() as Promise<T>;
}
