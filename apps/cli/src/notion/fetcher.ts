/**
 * Notion Fetcher
 *
 * Notion API からデータを取得して DB に保存
 */

import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import type { AdasDatabase } from "@repo/db";
import { type NotionQueueJob, notionDatabases, notionItems } from "@repo/db/schema";
import consola from "consola";
import { eq } from "drizzle-orm";
import { getDateString } from "../utils/date.js";
import { extractIcon, extractPageTitle, type NotionClient, serializeProperties } from "./client.js";

// Notion SDK の型定義に query メソッドが含まれていないため、独自の型を定義
interface QueryDatabaseParams {
  database_id: string;
  page_size?: number;
  start_cursor?: string;
  sorts?: Array<{ timestamp: string; direction: string }>;
}

interface QueryDatabaseResult {
  results: Array<{ object: string; [key: string]: unknown }>;
  has_more: boolean;
  next_cursor: string | null;
}

// Database 情報の型 (SDK の型定義が不完全なため独自定義)
interface DatabaseInfo {
  id: string;
  title: Array<{ plain_text: string }>;
  url: string;
  icon:
    | { type: "emoji"; emoji: string }
    | { type: "external"; external: { url: string } }
    | { type: "file"; file: { url: string } }
    | null;
  properties: Record<string, unknown>;
}

interface FetchResult {
  saved: number;
  nextCursor?: string;
}

/**
 * ジョブを処理
 */
export async function processNotionJob(
  db: AdasDatabase,
  client: NotionClient,
  job: NotionQueueJob,
): Promise<FetchResult> {
  switch (job.jobType) {
    case "fetch_recent_pages":
      return fetchRecentPages(db, client, job.cursor ?? undefined);
    case "fetch_database_items":
      if (!job.databaseId) {
        throw new Error("databaseId is required for fetch_database_items");
      }
      return fetchDatabaseItems(db, client, job.databaseId, job.cursor ?? undefined);
    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}

/**
 * 最近更新されたページを取得
 */
async function fetchRecentPages(
  db: AdasDatabase,
  client: NotionClient,
  cursor?: string,
): Promise<FetchResult> {
  const response = await client.search({
    filter: { property: "object", value: "page" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
    page_size: 50,
    start_cursor: cursor,
  });

  let saved = 0;

  for (const result of response.results) {
    if (result.object !== "page") continue;
    const page = result as PageObjectResponse;

    const savedCount = await savePage(db, page);
    saved += savedCount;
  }

  return {
    saved,
    nextCursor: response.has_more ? (response.next_cursor ?? undefined) : undefined,
  };
}

/**
 * データベースアイテムを取得
 */
async function fetchDatabaseItems(
  db: AdasDatabase,
  client: NotionClient,
  databaseId: string,
  cursor?: string,
): Promise<FetchResult> {
  // データベース情報を取得・保存
  try {
    const dbInfo = await client.databases.retrieve({ database_id: databaseId });
    if (dbInfo.object === "database" && "title" in dbInfo && "properties" in dbInfo) {
      saveDatabase(db, dbInfo as unknown as DatabaseInfo);
    }
  } catch (error) {
    consola.warn(`[Notion] Failed to retrieve database ${databaseId}:`, error);
  }

  // データベースアイテムを取得
  // Note: client.databases has query method at runtime but TypeScript types may be incomplete
  const queryFn = (
    client.databases as unknown as {
      query: (args: QueryDatabaseParams) => Promise<QueryDatabaseResult>;
    }
  ).query;
  const response = await queryFn({
    database_id: databaseId,
    page_size: 50,
    start_cursor: cursor,
    sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
  });

  let saved = 0;

  for (const result of response.results) {
    if (result.object !== "page") continue;
    const page = result as PageObjectResponse;

    const savedCount = await savePage(db, page, databaseId);
    saved += savedCount;
  }

  // 最終同期日時を更新
  const now = new Date().toISOString();
  db.update(notionDatabases)
    .set({ lastSyncedAt: now, updatedAt: now })
    .where(eq(notionDatabases.databaseId, databaseId))
    .run();

  return {
    saved,
    nextCursor: response.has_more ? (response.next_cursor ?? undefined) : undefined,
  };
}

/**
 * ページを DB に保存
 */
async function savePage(
  db: AdasDatabase,
  page: PageObjectResponse,
  databaseId?: string,
): Promise<number> {
  const now = new Date().toISOString();
  const title = extractPageTitle(page);
  const icon = extractIcon(page);
  const properties = serializeProperties(page.properties);
  const lastEditedBy =
    "last_edited_by" in page && page.last_edited_by && "name" in page.last_edited_by
      ? (page.last_edited_by.name as string | null)
      : null;

  // 親情報を取得
  let parentId: string | null = null;
  let parentType: "database" | "page" | "workspace" = "workspace";

  if (page.parent.type === "database_id") {
    parentId = page.parent.database_id;
    parentType = "database";
  } else if (page.parent.type === "page_id") {
    parentId = page.parent.page_id;
    parentType = "page";
  }

  // 既存レコードをチェック
  const existing = db
    .select({ id: notionItems.id, lastEditedTime: notionItems.lastEditedTime })
    .from(notionItems)
    .where(eq(notionItems.pageId, page.id))
    .get();

  if (existing) {
    // 更新がある場合のみ更新
    if (existing.lastEditedTime !== page.last_edited_time) {
      db.update(notionItems)
        .set({
          title,
          url: page.url,
          icon,
          parentId,
          parentType,
          databaseId: databaseId ?? parentId,
          properties: JSON.stringify(properties),
          lastEditedTime: page.last_edited_time,
          lastEditedBy,
          isRead: false, // 更新があったので未読にリセット
          syncedAt: now,
        })
        .where(eq(notionItems.id, existing.id))
        .run();
      return 1;
    }
    return 0;
  }

  // 新規作成
  const date = getDateString(new Date(page.last_edited_time));
  db.insert(notionItems)
    .values({
      date,
      pageId: page.id,
      parentId,
      parentType,
      databaseId: databaseId ?? parentId,
      title,
      url: page.url,
      icon,
      properties: JSON.stringify(properties),
      lastEditedTime: page.last_edited_time,
      lastEditedBy,
      isRead: false,
      priority: null,
      projectId: null,
      syncedAt: now,
      createdAt: now,
    })
    .run();

  return 1;
}

/**
 * データベース情報を保存
 */
function saveDatabase(db: AdasDatabase, dbInfo: DatabaseInfo) {
  const now = new Date().toISOString();
  const title = dbInfo.title.map((t) => t.plain_text).join("");
  let icon: string | null = null;

  if (dbInfo.icon) {
    if (dbInfo.icon.type === "emoji") {
      icon = dbInfo.icon.emoji;
    } else if (dbInfo.icon.type === "external") {
      icon = dbInfo.icon.external.url;
    } else if (dbInfo.icon.type === "file") {
      icon = dbInfo.icon.file.url;
    }
  }

  const existing = db
    .select({ id: notionDatabases.id })
    .from(notionDatabases)
    .where(eq(notionDatabases.databaseId, dbInfo.id))
    .get();

  if (existing) {
    db.update(notionDatabases)
      .set({
        title,
        url: dbInfo.url,
        icon,
        properties: JSON.stringify(dbInfo.properties),
        updatedAt: now,
      })
      .where(eq(notionDatabases.id, existing.id))
      .run();
  } else {
    db.insert(notionDatabases)
      .values({
        databaseId: dbInfo.id,
        title,
        url: dbInfo.url,
        icon,
        properties: JSON.stringify(dbInfo.properties),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}
