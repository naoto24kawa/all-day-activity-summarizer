/**
 * Notion DB Schema
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Notion Items (データベースアイテム・ページ)
// ---------------------------------------------------------------------------

export const notionItems = sqliteTable("notion_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  pageId: text("page_id").notNull().unique(), // Notion Page ID
  parentId: text("parent_id"), // 親 Database ID または Page ID
  parentType: text("parent_type", { enum: ["database", "page", "workspace"] }).notNull(),
  databaseId: text("database_id"), // データベースアイテムの場合のみ
  title: text("title").notNull(),
  url: text("url").notNull(),
  icon: text("icon"), // emoji または URL
  properties: text("properties"), // JSON: プロパティ値
  lastEditedTime: text("last_edited_time").notNull(), // ISO8601
  lastEditedBy: text("last_edited_by"),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  priority: text("priority", { enum: ["high", "medium", "low"] }),
  projectId: integer("project_id"), // FK to projects
  syncedAt: text("synced_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type NotionItem = typeof notionItems.$inferSelect;
export type NewNotionItem = typeof notionItems.$inferInsert;

// ---------------------------------------------------------------------------
// Notion Databases (監視対象データベース)
// ---------------------------------------------------------------------------

export const notionDatabases = sqliteTable("notion_databases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  databaseId: text("database_id").notNull().unique(), // Notion Database ID
  title: text("title").notNull(),
  url: text("url").notNull(),
  icon: text("icon"),
  properties: text("properties"), // JSON: プロパティスキーマ
  projectId: integer("project_id"), // FK to projects
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type NotionDatabase = typeof notionDatabases.$inferSelect;
export type NewNotionDatabase = typeof notionDatabases.$inferInsert;

// ---------------------------------------------------------------------------
// Notion Queue (取得キュー)
// ---------------------------------------------------------------------------

export const notionQueue = sqliteTable("notion_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type", {
    enum: ["fetch_recent_pages", "fetch_database_items"],
  }).notNull(),
  databaseId: text("database_id"), // fetch_database_items 時のみ
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] })
    .notNull()
    .default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  errorMessage: text("error_message"),
  lockedAt: text("locked_at"),
  runAfter: text("run_after").notNull(),
  cursor: text("cursor"), // ページネーション用
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type NotionQueueJob = typeof notionQueue.$inferSelect;
export type NewNotionQueueJob = typeof notionQueue.$inferInsert;
