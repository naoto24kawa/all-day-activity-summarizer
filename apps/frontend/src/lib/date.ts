/**
 * 日付ユーティリティ
 */

/**
 * 今日の日付を YYYY-MM-DD 形式で取得する
 */
export function getTodayDateString(): string {
  return getDateString(new Date());
}

/**
 * Date オブジェクトを YYYY-MM-DD 形式の文字列に変換する
 */
export function getDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// JST フォーマット関数
// ---------------------------------------------------------------------------

/**
 * ISO8601 文字列または Date を JST の時刻文字列 (HH:MM:SS) に変換する
 */
export function formatTimeJST(dateOrString: Date | string): string {
  const date = typeof dateOrString === "string" ? new Date(dateOrString) : dateOrString;
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * ISO8601 文字列または Date を JST の時刻文字列 (HH:MM) に変換する (秒なし)
 */
export function formatTimeShortJST(dateOrString: Date | string): string {
  const date = typeof dateOrString === "string" ? new Date(dateOrString) : dateOrString;
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * ISO8601 文字列または Date を JST の日付文字列 (YYYY/MM/DD) に変換する
 */
export function formatDateJST(dateOrString: Date | string): string {
  const date = typeof dateOrString === "string" ? new Date(dateOrString) : dateOrString;
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Slack の messageTs (Unix timestamp 文字列) を JST の時刻文字列 (HH:MM) に変換する
 */
export function formatSlackTsJST(messageTs: string): string {
  const seconds = Number(messageTs.split(".")[0]);
  const date = new Date(seconds * 1000);
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * GitHub の ISO8601 日時文字列を JST の日付時刻文字列 (MM/DD HH:MM) に変換する
 */
export function formatGitHubDateJST(isoString: string): string {
  const date = new Date(isoString);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${month}/${day} ${time}`;
}
