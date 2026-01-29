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
