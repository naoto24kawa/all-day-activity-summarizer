/**
 * Notion Tools for MCP Server
 *
 * Notion 関連の 4 ツール:
 * - list_notion_items: アイテム一覧取得
 * - upsert_notion_item: アイテム登録/更新
 * - upsert_notion_items_bulk: アイテム一括登録/更新
 * - get_notion_unread_count: 未読カウント取得
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotionItem, NotionUnreadCounts } from "@repo/types";
import { z } from "zod";
import { apiGet, apiPost } from "../api-client.js";

interface BulkResult {
  inserted: number;
  updated: number;
  errors: { index: number; error: string }[];
}

/** 一括登録用のアイテムスキーマ */
const notionItemSchema = z.object({
  date: z.string().describe("日付 (YYYY-MM-DD)"),
  pageId: z.string().describe("Notion Page ID"),
  parentType: z.enum(["database", "page", "workspace"]).describe("親タイプ"),
  title: z.string().describe("ページタイトル"),
  url: z.string().describe("ページ URL"),
  lastEditedTime: z.string().describe("最終更新日時 (ISO8601)"),
  parentId: z.string().optional().describe("親 ID (Database ID または Page ID)"),
  databaseId: z.string().optional().describe("データベース ID (データベースアイテムの場合)"),
  icon: z.string().optional().describe("アイコン (emoji または URL)"),
  properties: z.string().optional().describe("プロパティ (JSON 文字列)"),
  lastEditedBy: z.string().optional().describe("最終更新者"),
  priority: z.enum(["high", "medium", "low"]).optional().describe("優先度"),
  projectId: z.number().optional().describe("プロジェクト ID"),
});

export function registerNotionTools(server: McpServer): void {
  /**
   * list_notion_items - Notion アイテム一覧取得
   */
  server.tool(
    "list_notion_items",
    "Notion アイテム一覧を取得する。date/unread/databaseId でフィルタ可能",
    {
      date: z.string().optional().describe("日付でフィルタ (YYYY-MM-DD)"),
      unread: z.boolean().optional().describe("未読のみ取得する場合は true"),
      databaseId: z.string().optional().describe("データベース ID でフィルタ"),
      projectId: z.number().optional().describe("プロジェクト ID でフィルタ"),
      limit: z.number().optional().describe("取得件数の上限 (デフォルト: 100)"),
    },
    async ({ date, unread, databaseId, projectId, limit }) => {
      const params: Record<string, string | number | undefined> = {
        date,
        databaseId,
        projectId,
        limit,
      };

      if (unread !== undefined) {
        params.unread = unread ? "true" : "false";
      }

      const response = await apiGet<NotionItem[]>("/notion-items", params);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Notion アイテム取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const items = response.data;

      if (items.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "該当する Notion アイテムはありません。",
            },
          ],
        };
      }

      const itemList = items
        .map((item) => {
          const priorityLabel = item.priority ? `[${item.priority}]` : "";
          const readStatus = item.isRead ? "" : "[未読]";
          const icon = item.icon || "📄";
          const preview = item.title.length > 60 ? `${item.title.substring(0, 60)}...` : item.title;
          return `- #${item.id} ${priorityLabel}${readStatus} ${icon} ${preview}\n  ${item.url}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Notion アイテム一覧 (${items.length}件):\n\n${itemList}`,
          },
        ],
      };
    },
  );

  /**
   * upsert_notion_item - Notion アイテム登録/更新
   */
  server.tool(
    "upsert_notion_item",
    "Notion アイテムを登録/更新する (外部からのデータ取り込み用)。同じ pageId が存在する場合は更新",
    {
      date: z.string().describe("日付 (YYYY-MM-DD)"),
      pageId: z.string().describe("Notion Page ID"),
      parentType: z.enum(["database", "page", "workspace"]).describe("親タイプ"),
      title: z.string().describe("ページタイトル"),
      url: z.string().describe("ページ URL"),
      lastEditedTime: z.string().describe("最終更新日時 (ISO8601)"),
      parentId: z.string().optional().describe("親 ID (Database ID または Page ID)"),
      databaseId: z.string().optional().describe("データベース ID (データベースアイテムの場合)"),
      icon: z.string().optional().describe("アイコン (emoji または URL)"),
      properties: z.string().optional().describe("プロパティ (JSON 文字列)"),
      lastEditedBy: z.string().optional().describe("最終更新者"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("優先度"),
      projectId: z.number().optional().describe("紐づけるプロジェクト ID"),
    },
    async ({
      date,
      pageId,
      parentType,
      title,
      url,
      lastEditedTime,
      parentId,
      databaseId,
      icon,
      properties,
      lastEditedBy,
      priority,
      projectId,
    }) => {
      const response = await apiPost<NotionItem & { updated?: boolean }>("/notion-items", {
        date,
        pageId,
        parentType,
        title,
        url,
        lastEditedTime,
        parentId,
        databaseId,
        icon,
        properties,
        lastEditedBy,
        isRead: false,
        priority,
        projectId,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Notion アイテム作成エラー: ${response.error}`,
            },
          ],
        };
      }

      const item = response.data;
      const action = item.updated ? "更新" : "登録";
      return {
        content: [
          {
            type: "text" as const,
            text: `Notion アイテムを${action}しました:\n- ID: #${item.id}\n- タイトル: ${item.title}\n- 親タイプ: ${item.parentType}\n- URL: ${item.url}`,
          },
        ],
      };
    },
  );

  /**
   * upsert_notion_items_bulk - Notion アイテム一括登録/更新
   */
  server.tool(
    "upsert_notion_items_bulk",
    "複数の Notion アイテムを一括登録/更新する (最大100件)。同じ pageId が存在する場合は更新",
    {
      items: z.array(notionItemSchema).describe("登録するアイテムの配列 (最大100件)"),
    },
    async ({ items }) => {
      if (items.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "アイテムが指定されていません。",
            },
          ],
        };
      }

      if (items.length > 100) {
        return {
          content: [
            {
              type: "text" as const,
              text: "一度に登録できるアイテムは最大100件です。",
            },
          ],
        };
      }

      const response = await apiPost<BulkResult>("/notion-items/bulk", {
        items: items.map((item) => ({ ...item, isRead: false })),
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `一括登録エラー: ${response.error}`,
            },
          ],
        };
      }

      const result = response.data;
      let text = `Notion アイテム一括登録結果:\n- 新規登録: ${result.inserted}件\n- 更新: ${result.updated}件`;

      if (result.errors.length > 0) {
        text += `\n- エラー: ${result.errors.length}件`;
        for (const err of result.errors.slice(0, 5)) {
          text += `\n  - [${err.index}]: ${err.error}`;
        }
        if (result.errors.length > 5) {
          text += `\n  - ... 他 ${result.errors.length - 5}件`;
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    },
  );

  /**
   * get_notion_unread_count - 未読カウント取得
   */
  server.tool(
    "get_notion_unread_count",
    "Notion の未読アイテム数を取得する",
    {
      date: z.string().optional().describe("日付でフィルタ (YYYY-MM-DD)"),
    },
    async ({ date }) => {
      const response = await apiGet<NotionUnreadCounts>("/notion-items/unread-count", {
        date,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `未読カウント取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const counts = response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Notion 未読アイテム数:\n- 合計: ${counts.total}\n- データベース: ${counts.database}\n- ページ: ${counts.page}`,
          },
        ],
      };
    },
  );
}
