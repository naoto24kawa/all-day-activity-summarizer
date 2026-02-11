/**
 * Notion 型定義
 */

/** Notion アイテムの親タイプ */
export type NotionParentType = "database" | "page" | "workspace";

/** Notion アイテム (データベースアイテム・ページ) */
export interface NotionItem {
  id: number;
  date: string; // YYYY-MM-DD
  pageId: string; // Notion Page ID (unique)
  parentId: string | null; // 親 Database ID または Page ID
  parentType: NotionParentType;
  databaseId: string | null; // データベースアイテムの場合のみ
  title: string;
  url: string;
  icon: string | null; // emoji または URL
  properties: string | null; // JSON: プロパティ値
  content: string | null; // ページ本文 (Markdown)
  contentSyncedAt: string | null; // 本文の最終同期日時
  lastEditedTime: string; // ISO8601
  lastEditedBy: string | null; // ユーザー名
  isRead: boolean;
  priority: NotionItemPriority | null;
  projectId: number | null;
  syncedAt: string;
  createdAt: string;
}

/** Notion アイテム優先度 */
export type NotionItemPriority = "high" | "medium" | "low";

/** Notion データベース (監視対象) */
export interface NotionDatabase {
  id: number;
  databaseId: string; // Notion Database ID (unique)
  title: string;
  url: string;
  icon: string | null;
  properties: string | null; // JSON: プロパティスキーマ
  projectId: number | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Notion キュージョブタイプ */
export type NotionQueueJobType =
  | "fetch_recent_pages"
  | "fetch_database_items"
  | "fetch_page_content";

/** Notion キュージョブステータス */
export type NotionQueueJobStatus = "pending" | "processing" | "completed" | "failed";

/** Notion キュージョブ */
export interface NotionQueueJob {
  id: number;
  jobType: NotionQueueJobType;
  databaseId: string | null; // fetch_database_items 時のみ
  pageId: string | null; // fetch_page_content 時のみ
  status: NotionQueueJobStatus;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  lockedAt: string | null;
  runAfter: string;
  cursor: string | null; // ページネーション用
  createdAt: string;
  updatedAt: string;
}

/** Notion 未読数 */
export interface NotionUnreadCounts {
  total: number;
  database: number;
  page: number;
}

/** Notion 設定 */
export interface NotionConfig {
  enabled: boolean;
  token?: string;
  fetchIntervalMinutes: number;
  parallelWorkers: number;
  databaseIds: string[];
}
