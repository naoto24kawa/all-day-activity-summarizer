/**
 * 日付ユーティリティ
 *
 * 日付操作のための共通関数を提供する。
 * CLI とフロントエンドの両方で使用可能。
 */

/**
 * 今日の日付を YYYY-MM-DD 形式で取得する
 *
 * @returns 今日の日付 (例: "2025-01-29")
 */
export function getTodayDateString(): string {
  return getDateString(new Date());
}

/**
 * Date オブジェクトを YYYY-MM-DD 形式の文字列に変換する
 *
 * @param date - 変換する Date オブジェクト
 * @returns 日付文字列 (例: "2025-01-29")
 */
export function getDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
