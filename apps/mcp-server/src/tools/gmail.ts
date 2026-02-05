/**
 * Gmail Tools for MCP Server
 *
 * Gmail 関連の 4 ツール:
 * - list_gmail_messages: メッセージ一覧取得
 * - upsert_gmail_message: メッセージ登録/更新
 * - upsert_gmail_messages_bulk: メッセージ一括登録/更新
 * - get_gmail_unread_count: 未読カウント取得
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GmailMessage, GmailUnreadCounts } from "@repo/types";
import { z } from "zod";
import { apiGet, apiPost } from "../api-client.js";

interface BulkResult {
  inserted: number;
  updated: number;
  errors: { index: number; error: string }[];
}

/** Gmail メッセージタイプ */
const gmailMessageTypes = ["direct", "cc", "mailing_list", "notification", "newsletter"] as const;

/** Gmail 優先度 */
const gmailPriorities = ["high", "medium", "low"] as const;

/** 一括登録用のメッセージスキーマ */
const gmailMessageSchema = z.object({
  date: z.string().describe("日付 (YYYY-MM-DD)"),
  messageId: z.string().describe("Gmail メッセージ ID"),
  threadId: z.string().describe("Gmail スレッド ID"),
  fromEmail: z.string().describe("送信者のメールアドレス"),
  fromName: z.string().optional().describe("送信者の表示名"),
  toEmails: z.array(z.string()).describe("宛先メールアドレスの配列"),
  ccEmails: z.array(z.string()).optional().describe("CC メールアドレスの配列"),
  subject: z.string().describe("件名"),
  snippet: z.string().optional().describe("本文のプレビュー"),
  body: z.string().optional().describe("本文 (HTML)"),
  bodyPlain: z.string().optional().describe("本文 (プレーンテキスト)"),
  labels: z.array(z.string()).optional().describe("Gmail ラベルの配列"),
  hasAttachments: z.boolean().optional().describe("添付ファイルの有無"),
  messageType: z.enum(gmailMessageTypes).describe("メッセージタイプ"),
  priority: z.enum(gmailPriorities).optional().describe("優先度"),
  projectId: z.number().optional().describe("プロジェクト ID"),
  receivedAt: z.string().describe("受信日時 (ISO8601)"),
});

export function registerGmailTools(server: McpServer): void {
  /**
   * list_gmail_messages - Gmail メッセージ一覧取得
   */
  server.tool(
    "list_gmail_messages",
    "Gmail メッセージ一覧を取得する。type/unread/starred/priority/label でフィルタ可能",
    {
      date: z.string().optional().describe("日付でフィルタ (YYYY-MM-DD)"),
      type: z.enum(gmailMessageTypes).optional().describe("メッセージタイプでフィルタ"),
      unread: z.boolean().optional().describe("未読のみ取得する場合は true"),
      starred: z.boolean().optional().describe("スター付きのみ取得する場合は true"),
      priority: z.enum(gmailPriorities).optional().describe("優先度でフィルタ"),
      label: z.string().optional().describe("Gmail ラベルでフィルタ"),
      projectId: z.number().optional().describe("プロジェクト ID でフィルタ"),
      limit: z.number().optional().describe("取得件数の上限 (デフォルト: 100)"),
    },
    async ({ date, type, unread, starred, priority, label, projectId, limit }) => {
      const params: Record<string, string | number | undefined> = {
        date,
        type,
        priority,
        label,
        projectId,
        limit,
      };

      if (unread !== undefined) {
        params.unread = unread ? "true" : "false";
      }

      if (starred !== undefined) {
        params.starred = starred ? "true" : "false";
      }

      const response = await apiGet<GmailMessage[]>("/gmail-messages", params);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Gmail メッセージ取得エラー: ${response.error}`,
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
              text: "該当する Gmail メッセージはありません。",
            },
          ],
        };
      }

      const messageList = messages
        .map((m) => {
          const priorityLabel = m.priority ? `[${m.priority}]` : "";
          const readStatus = m.isRead ? "" : "[未読]";
          const starStatus = m.isStarred ? "★" : "";
          const from = m.fromName || m.fromEmail;
          const subjectPreview =
            m.subject.length > 50 ? `${m.subject.substring(0, 50)}...` : m.subject;
          return `- #${m.id} ${priorityLabel}${readStatus}${starStatus} From: ${from}\n  ${subjectPreview}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Gmail メッセージ一覧 (${messages.length}件):\n\n${messageList}`,
          },
        ],
      };
    },
  );

  /**
   * upsert_gmail_message - Gmail メッセージ登録/更新
   */
  server.tool(
    "upsert_gmail_message",
    "Gmail メッセージを登録/更新する (外部からのデータ取り込み用)。同じ messageId+threadId が存在する場合は更新",
    {
      date: z.string().describe("日付 (YYYY-MM-DD)"),
      messageId: z.string().describe("Gmail メッセージ ID"),
      threadId: z.string().describe("Gmail スレッド ID"),
      fromEmail: z.string().describe("送信者のメールアドレス"),
      fromName: z.string().optional().describe("送信者の表示名"),
      toEmails: z.array(z.string()).describe("宛先メールアドレスの配列"),
      ccEmails: z.array(z.string()).optional().describe("CC メールアドレスの配列"),
      subject: z.string().describe("件名"),
      snippet: z.string().optional().describe("本文のプレビュー"),
      body: z.string().optional().describe("本文 (HTML)"),
      bodyPlain: z.string().optional().describe("本文 (プレーンテキスト)"),
      labels: z.array(z.string()).optional().describe("Gmail ラベルの配列"),
      hasAttachments: z.boolean().optional().describe("添付ファイルの有無"),
      messageType: z
        .enum(gmailMessageTypes)
        .describe("メッセージタイプ (direct/cc/mailing_list/notification/newsletter)"),
      priority: z.enum(gmailPriorities).optional().describe("優先度"),
      projectId: z.number().optional().describe("紐づけるプロジェクト ID"),
      receivedAt: z.string().describe("受信日時 (ISO8601)"),
    },
    async ({
      date,
      messageId,
      threadId,
      fromEmail,
      fromName,
      toEmails,
      ccEmails,
      subject,
      snippet,
      body,
      bodyPlain,
      labels,
      hasAttachments,
      messageType,
      priority,
      projectId,
      receivedAt,
    }) => {
      const response = await apiPost<GmailMessage>("/gmail-messages", {
        date,
        messageId,
        threadId,
        fromEmail,
        fromName,
        toEmails,
        ccEmails,
        subject,
        snippet,
        body,
        bodyPlain,
        labels,
        hasAttachments,
        messageType,
        priority,
        projectId,
        receivedAt,
        isRead: false,
        isStarred: false,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Gmail メッセージ登録エラー: ${response.error}`,
            },
          ],
        };
      }

      const message = response.data as GmailMessage & { updated?: boolean };
      const action = message.updated ? "更新" : "登録";
      return {
        content: [
          {
            type: "text" as const,
            text: `Gmail メッセージを${action}しました:\n- ID: #${message.id}\n- From: ${message.fromName || message.fromEmail}\n- 件名: ${message.subject}\n- タイプ: ${message.messageType}`,
          },
        ],
      };
    },
  );

  /**
   * upsert_gmail_messages_bulk - Gmail メッセージ一括登録/更新
   */
  server.tool(
    "upsert_gmail_messages_bulk",
    "複数の Gmail メッセージを一括登録/更新する (最大100件)。同じ messageId+threadId が存在する場合は更新",
    {
      messages: z.array(gmailMessageSchema).describe("登録するメッセージの配列 (最大100件)"),
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

      const response = await apiPost<BulkResult>("/gmail-messages/bulk", {
        messages: messages.map((m) => ({ ...m, isRead: false, isStarred: false })),
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
      let text = `Gmail メッセージ一括登録結果:\n- 新規登録: ${result.inserted}件\n- 更新: ${result.updated}件`;

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
   * get_gmail_unread_count - 未読カウント取得
   */
  server.tool(
    "get_gmail_unread_count",
    "Gmail の未読メッセージ数を取得する",
    {
      date: z.string().optional().describe("日付でフィルタ (YYYY-MM-DD)"),
    },
    async ({ date }) => {
      const response = await apiGet<GmailUnreadCounts>("/gmail-messages/unread-count", {
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
            text: `Gmail 未読メッセージ数:
- 合計: ${counts.total}
- 種別:
  - Direct: ${counts.direct}
  - CC: ${counts.cc}
  - メーリングリスト: ${counts.mailingList}
  - 通知: ${counts.notification}
  - ニュースレター: ${counts.newsletter}
- 優先度別:
  - High: ${counts.byPriority.high}
  - Medium: ${counts.byPriority.medium}
  - Low: ${counts.byPriority.low}
  - 未設定: ${counts.byPriority.unassigned}`,
          },
        ],
      };
    },
  );
}
