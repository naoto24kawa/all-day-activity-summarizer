/**
 * ADAS CLI API Client
 *
 * CLI API (localhost:3001/api) へのリクエストヘルパー
 */

const DEFAULT_API_URL = "http://localhost:3001";

function getApiUrl(): string {
  return process.env.ADAS_API_URL || DEFAULT_API_URL;
}

/**
 * パスを正規化 (/api/xxx の形式に統一)
 */
function normalizePath(path: string): string {
  // 先頭の / を削除
  const cleanPath = path.replace(/^\/+/, "");
  // /api で始まっていなければ追加
  if (cleanPath.startsWith("api/")) {
    return `/${cleanPath}`;
  }
  return `/api/${cleanPath}`;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status: number;
}

/**
 * GET リクエスト
 */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<ApiResponse<T>> {
  const baseUrl = getApiUrl();
  const url = new URL(normalizePath(path), baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  try {
    const response = await fetch(url.toString());
    const status = response.status;

    if (!response.ok) {
      const errorBody = await response.text();
      return { ok: false, error: errorBody || `HTTP ${status}`, status };
    }

    const data = (await response.json()) as T;
    return { ok: true, data, status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      status: 0,
    };
  }
}

/**
 * POST リクエスト
 */
export async function apiPost<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  const baseUrl = getApiUrl();
  const url = new URL(normalizePath(path), baseUrl);

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const status = response.status;

    if (!response.ok) {
      const errorBody = await response.text();
      return { ok: false, error: errorBody || `HTTP ${status}`, status };
    }

    const data = (await response.json()) as T;
    return { ok: true, data, status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      status: 0,
    };
  }
}

/**
 * PATCH リクエスト
 */
export async function apiPatch<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  const baseUrl = getApiUrl();
  const url = new URL(normalizePath(path), baseUrl);

  try {
    const response = await fetch(url.toString(), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const status = response.status;

    if (!response.ok) {
      const errorBody = await response.text();
      return { ok: false, error: errorBody || `HTTP ${status}`, status };
    }

    const data = (await response.json()) as T;
    return { ok: true, data, status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      status: 0,
    };
  }
}
