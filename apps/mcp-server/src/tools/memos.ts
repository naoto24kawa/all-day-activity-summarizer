/**
 * Memo Tools for MCP Server
 *
 * メモ関連の 2 ツール:
 * - list_memos: メモ一覧取得
 * - create_memo: メモ作成
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Memo, MemosResponse } from "@repo/types";
import { z } from "zod";
import { apiGet, apiPost } from "../api-client.js";

export function registerMemoTools(server: McpServer): void {
  /**
   * list_memos - メモ一覧取得
   */
  server.tool(
    "list_memos",
    "メモ一覧を取得する。最新順でソート済み",
    {
      limit: z.number().optional().describe("取得件数の上限 (デフォルト: 50)"),
      offset: z.number().optional().describe("オフセット (ページネーション用)"),
    },
    async ({ limit, offset }) => {
      const response = await apiGet<MemosResponse>("/memos", {
        limit,
        offset,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `メモ取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const { memos, total, hasMore } = response.data;

      if (memos.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "メモはありません。",
            },
          ],
        };
      }

      const memoList = memos
        .map((m) => {
          const tags = m.tags ? ` [${JSON.parse(m.tags).join(", ")}]` : "";
          const preview = m.content.length > 100 ? `${m.content.substring(0, 100)}...` : m.content;
          return `- #${m.id} (${m.date})${tags}\n  ${preview}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `メモ一覧 (${memos.length}/${total}件)${hasMore ? " ※続きあり" : ""}:\n\n${memoList}`,
          },
        ],
      };
    },
  );

  /**
   * create_memo - メモ作成
   */
  server.tool(
    "create_memo",
    "新しいメモを作成する。タグは AI が自動付与する",
    {
      content: z.string().describe("メモの内容"),
      tags: z.array(z.string()).optional().describe("タグ (省略時は AI が自動付与)"),
      projectId: z.number().optional().describe("紐づけるプロジェクトID"),
    },
    async ({ content, tags, projectId }) => {
      const response = await apiPost<Memo>("/memos", {
        content,
        tags,
        projectId,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `メモ作成エラー: ${response.error}`,
            },
          ],
        };
      }

      const memo = response.data;
      const tagsStr = memo.tags ? ` [${JSON.parse(memo.tags).join(", ")}]` : "";

      return {
        content: [
          {
            type: "text" as const,
            text: `メモを作成しました:\n- ID: #${memo.id}\n- 日付: ${memo.date}${tagsStr}\n- 内容: ${memo.content}`,
          },
        ],
      };
    },
  );
}
