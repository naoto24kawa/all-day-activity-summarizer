/**
 * Notion API Client
 *
 * @notionhq/client を使用した Notion API クライアント
 */

import { Client } from "@notionhq/client";
import type {
  DatabaseObjectResponse,
  PageObjectResponse,
  PartialDatabaseObjectResponse,
  PartialPageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import type { AdasConfig } from "../config.js";

export type NotionClient = Client;

/**
 * Notion クライアントを作成
 */
export function createNotionClient(config: AdasConfig["notion"]): NotionClient | null {
  if (!config.token) {
    return null;
  }
  return new Client({ auth: config.token });
}

/**
 * Page からタイトルを抽出
 */
export function extractPageTitle(page: PageObjectResponse | PartialPageObjectResponse): string {
  if (!("properties" in page)) {
    return "Untitled";
  }

  // タイトルプロパティを探す
  for (const [, value] of Object.entries(page.properties)) {
    if (value.type === "title" && "title" in value) {
      const titleArray = value.title;
      if (Array.isArray(titleArray) && titleArray.length > 0) {
        return titleArray.map((t) => ("plain_text" in t ? t.plain_text : "")).join("");
      }
    }
  }

  return "Untitled";
}

/**
 * Page からアイコンを抽出
 */
export function extractIcon(page: PageObjectResponse | DatabaseObjectResponse): string | null {
  if (!page.icon) {
    return null;
  }

  if (page.icon.type === "emoji") {
    return page.icon.emoji;
  }

  if (page.icon.type === "external") {
    return page.icon.external.url;
  }

  if (page.icon.type === "file") {
    return page.icon.file.url;
  }

  return null;
}

/**
 * Database からタイトルを抽出
 */
export function extractDatabaseTitle(
  db: DatabaseObjectResponse | PartialDatabaseObjectResponse,
): string {
  if (!("title" in db)) {
    return "Untitled";
  }

  const titleArray = db.title;
  if (Array.isArray(titleArray) && titleArray.length > 0) {
    return titleArray.map((t) => ("plain_text" in t ? t.plain_text : "")).join("");
  }

  return "Untitled";
}

/**
 * プロパティ値を簡易的な JSON 形式に変換
 */
export function serializeProperties(
  properties: PageObjectResponse["properties"],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    switch (value.type) {
      case "title":
        result[key] = value.title.map((t) => t.plain_text).join("");
        break;
      case "rich_text":
        result[key] = value.rich_text.map((t) => t.plain_text).join("");
        break;
      case "number":
        result[key] = value.number;
        break;
      case "select":
        result[key] = value.select?.name ?? null;
        break;
      case "multi_select":
        result[key] = value.multi_select.map((s) => s.name);
        break;
      case "date":
        result[key] = value.date ? { start: value.date.start, end: value.date.end } : null;
        break;
      case "checkbox":
        result[key] = value.checkbox;
        break;
      case "url":
        result[key] = value.url;
        break;
      case "email":
        result[key] = value.email;
        break;
      case "phone_number":
        result[key] = value.phone_number;
        break;
      case "status":
        result[key] = value.status?.name ?? null;
        break;
      case "people":
        result[key] = value.people.map((p) => ("name" in p ? p.name : p.id));
        break;
      case "files":
        result[key] = value.files.map((f) => {
          if (f.type === "external") return f.external.url;
          if (f.type === "file") return f.file.url;
          return null;
        });
        break;
      case "relation":
        result[key] = value.relation.map((r) => r.id);
        break;
      case "formula":
        if (value.formula.type === "string") result[key] = value.formula.string;
        else if (value.formula.type === "number") result[key] = value.formula.number;
        else if (value.formula.type === "boolean") result[key] = value.formula.boolean;
        else if (value.formula.type === "date") result[key] = value.formula.date;
        break;
      case "rollup":
        // rollup は複雑なので型のみ記録
        result[key] = { type: "rollup", rollupType: value.rollup.type };
        break;
      case "created_time":
        result[key] = value.created_time;
        break;
      case "created_by":
        result[key] = "name" in value.created_by ? value.created_by.name : value.created_by.id;
        break;
      case "last_edited_time":
        result[key] = value.last_edited_time;
        break;
      case "last_edited_by":
        result[key] =
          "name" in value.last_edited_by ? value.last_edited_by.name : value.last_edited_by.id;
        break;
      default:
        result[key] = null;
    }
  }

  return result;
}
