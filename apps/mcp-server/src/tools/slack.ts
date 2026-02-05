/**
 * Slack Tools for MCP Server
 *
 * Slack 関連の 4 ツール:
 * - list_slack_messages: メッセージ一覧取得
 * - create_slack_message: メッセージ作成
 * - create_slack_messages_bulk: メッセージ一括作成
 * - get_slack_unread_count: 未読カウント取得
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SlackMessage } from "@repo/types";
import { z } from "zod";
import { apiGet, apiPost } from "../api-client.js";

interface UnreadCounts {
  total: number;
  mention: number;
  channel: number;
  dm: number;
  keyword: number;
}

interface BulkResult {
  inserted: number;
  duplicates: number;
  errors: { index: number; error: string }[];
}

/** 一括登録用のメッセージスキーマ */
const slackMessageSchema = z.object({
  date: z.string().describe("日付 (YYYY-MM-DD)"),
  messageTs: z.string().describe("メッセージのタイムスタンプ (Slack の ts)"),
  channelId: z.string().describe("チャンネル ID"),
  userId: z.string().describe("送信者のユーザー ID"),
  messageType: z.enum(["mention", "channel", "dm", "keyword"]).describe("メッセージタイプ"),
  text: z.string().describe("メッセージ本文"),
  channelName: z.string().optional().describe("チャンネル名"),
  userName: z.string().optional().describe("送信者名"),
  threadTs: z.string().optional().describe("スレッドのタイムスタンプ"),
  permalink: z.string().optional().describe("パーマリンク"),
  priority: z.enum(["high", "medium", "low"]).optional().describe("優先度"),
  projectId: z.number().optional().describe("プロジェクトID"),
});

export function registerSlackTools(server: McpServer): void {
  /**
   * list_slack_messages - Slack メッセージ一覧取得
   */
  server.tool(
    "list_slack_messages",
    "Slack メッセージ一覧を取得する。type/unread/priority でフィルタ可能",
    {
      type: z
        .enum(["mention", "channel", "dm", "keyword"])
        .optional()
        .describe("メッセージタイプでフィルタ"),
      unread: z.boolean().optional().describe("未読のみ取得する場合は true"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("優先度でフィルタ"),
      projectId: z.number().optional().describe("プロジェクトIDでフィルタ"),
      limit: z.number().optional().describe("取得件数の上限 (デフォルト: 100)"),
    },
    async ({ type, unread, priority, projectId, limit }) => {
      const params: Record<string, string | number | undefined> = {
        type,
        priority,
        projectId,
        limit,
      };

      if (unread !== undefined) {
        params.unread = unread ? "true" : "false";
      }

      const response = await apiGet<SlackMessage[]>("/slack-messages", params);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Slack メッセージ取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const messages = response.data;

      if (messages.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "該当する Slack メッセージはありません。",
            },
          ],
        };
      }

      const messageList = messages
        .map((m) => {
          const priorityLabel = m.priority ? `[${m.priority}]` : "";
          const readStatus = m.isRead ? "" : "[未読]";
          const channel = m.channelName ? `#${m.channelName}` : m.channelId;
          const user = m.userName || m.userId;
          const preview = m.text.length > 80 ? `${m.text.substring(0, 80)}...` : m.text;
          return `- #${m.id} ${priorityLabel}${readStatus} ${channel} @${user}\n  ${preview}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Slack メッセージ一覧 (${messages.length}件):\n\n${messageList}`,
          },
        ],
      };
    },
  );

  /**
   * create_slack_message - Slack メッセージ作成
   */
  server.tool(
    "create_slack_message",
    "Slack メッセージを登録する (外部からのデータ取り込み用)",
    {
      date: z.string().describe("日付 (YYYY-MM-DD)"),
      messageTs: z.string().describe("メッセージのタイムスタンプ (Slack の ts)"),
      channelId: z.string().describe("チャンネル ID"),
      userId: z.string().describe("送信者のユーザー ID"),
      messageType: z
        .enum(["mention", "channel", "dm", "keyword"])
        .describe("メッセージタイプ (mention/channel/dm/keyword)"),
      text: z.string().describe("メッセージ本文"),
      channelName: z.string().optional().describe("チャンネル名"),
      userName: z.string().optional().describe("送信者名"),
      threadTs: z.string().optional().describe("スレッドのタイムスタンプ"),
      permalink: z.string().optional().describe("メッセージへのパーマリンク"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("優先度"),
      projectId: z.number().optional().describe("紐づけるプロジェクトID"),
    },
    async ({
      date,
      messageTs,
      channelId,
      userId,
      messageType,
      text,
      channelName,
      userName,
      threadTs,
      permalink,
      priority,
      projectId,
    }) => {
      const response = await apiPost<SlackMessage>("/slack-messages", {
        date,
        messageTs,
        channelId,
        userId,
        messageType,
        text,
        channelName,
        userName,
        threadTs,
        permalink,
        priority,
        projectId,
        isRead: false,
      });

      if (!response.ok) {
        // 重複の場合
        if (response.status === 409) {
          return {
            content: [
              {
                type: "text" as const,
                text: "このメッセージは既に登録されています。",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Slack メッセージ作成エラー: ${response.error}`,
            },
          ],
        };
      }

      const message = response.data!;
      return {
        content: [
          {
            type: "text" as const,
            text: `Slack メッセージを登録しました:\n- ID: #${message.id}\n- チャンネル: ${message.channelName || message.channelId}\n- 送信者: ${message.userName || message.userId}\n- タイプ: ${message.messageType}`,
          },
        ],
      };
    },
  );

  /**
   * create_slack_messages_bulk - Slack メッセージ一括作成
   */
  server.tool(
    "create_slack_messages_bulk",
    "複数の Slack メッセージを一括登録する (最大100件)",
    {
      messages: z.array(slackMessageSchema).describe("登録するメッセージの配列 (最大100件)"),
    },
    async ({ messages }) => {
      if (messages.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "メッセージが指定されていません。",
            },
          ],
        };
      }

      if (messages.length > 100) {
        return {
          content: [
            {
              type: "text" as const,
              text: "一度に登録できるメッセージは最大100件です。",
            },
          ],
        };
      }

      const response = await apiPost<BulkResult>("/slack-messages/bulk", {
        messages: messages.map((m) => ({ ...m, isRead: false })),
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
      let text = `Slack メッセージ一括登録結果:\n- 登録成功: ${result.inserted}件\n- 重複スキップ: ${result.duplicates}件`;

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
   * get_slack_unread_count - 未読カウント取得
   */
  server.tool(
    "get_slack_unread_count",
    "Slack の未読メッセージ数を取得する",
    {
      date: z.string().optional().describe("日付でフィルタ (YYYY-MM-DD)"),
    },
    async ({ date }) => {
      const response = await apiGet<UnreadCounts>("/slack-messages/unread-count", {
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
            text: `Slack 未読メッセージ数:\n- 合計: ${counts.total}\n- メンション: ${counts.mention}\n- チャンネル: ${counts.channel}\n- DM: ${counts.dm}\n- キーワード: ${counts.keyword}`,
          },
        ],
      };
    },
  );
}
