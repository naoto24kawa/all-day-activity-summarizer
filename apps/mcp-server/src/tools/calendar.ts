/**
 * Calendar Tools for MCP Server
 *
 * カレンダー関連のツール:
 * - list_calendar_events: イベント一覧取得
 * - get_calendar_event: 単一イベント取得
 * - create_calendar_event: イベント作成
 * - delete_calendar_event: イベント削除
 * - sync_calendar: Google Calendar から同期
 * - mark_calendar_read: 既読にする
 * - get_calendar_stats: 統計取得
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api-client.js";

interface CalendarEvent {
  id: number;
  date: string;
  eventId: string;
  calendarId: string;
  summary: string;
  description: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  attendees: Array<{ email: string; displayName?: string; responseStatus: string }> | null;
  organizer: { email: string; displayName?: string } | null;
  conferenceLink: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  isRead: boolean;
  projectId: number | null;
  syncedAt: string;
  createdAt: string;
}

interface CalendarStats {
  total: number;
  unread: number;
  read: number;
  byStatus: {
    confirmed: number;
    tentative: number;
    cancelled: number;
  };
  allDay: number;
  withMeeting: number;
}

interface SyncResponse {
  message: string;
  jobId?: number;
  calendarId: string;
}

interface MarkReadResponse {
  updated: number;
}

interface DeleteResponse {
  deleted: boolean;
  id: number;
}

export function registerCalendarTools(server: McpServer): void {
  /**
   * list_calendar_events - イベント一覧取得
   */
  server.tool(
    "list_calendar_events",
    "カレンダーイベント一覧を取得する",
    {
      date: z.string().optional().describe("日付でフィルタ (YYYY-MM-DD)"),
      startDate: z.string().optional().describe("開始日 (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("終了日 (YYYY-MM-DD)"),
      unread: z.boolean().optional().describe("未読のみ取得する場合は true"),
      limit: z.number().optional().describe("取得件数の上限 (デフォルト: 100)"),
    },
    async ({ date, startDate, endDate, unread, limit }) => {
      const response = await apiGet<CalendarEvent[]>("/calendar", {
        date,
        startDate,
        endDate,
        unread: unread?.toString(),
        limit,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `カレンダー取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const events = response.data;

      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "カレンダーイベントはありません。",
            },
          ],
        };
      }

      const eventList = events
        .map((e) => {
          const time = e.isAllDay ? "終日" : `${formatTime(e.startTime)}-${formatTime(e.endTime)}`;
          const location = e.location ? ` @${e.location}` : "";
          const meeting = e.conferenceLink ? " 📹" : "";
          const unreadMark = e.isRead ? "" : " 🔵";
          return `- #${e.id} [${e.date}] ${time}${unreadMark}\n  ${e.summary}${location}${meeting}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `カレンダーイベント (${events.length}件):\n\n${eventList}`,
          },
        ],
      };
    },
  );

  /**
   * get_calendar_event - 単一イベント取得
   */
  server.tool(
    "get_calendar_event",
    "カレンダーイベントの詳細を取得する",
    {
      id: z.number().describe("イベントID"),
    },
    async ({ id }) => {
      const response = await apiGet<CalendarEvent>(`/calendar/${id}`);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `イベント取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const e = response.data;
      const time = e.isAllDay ? "終日" : `${formatTime(e.startTime)} - ${formatTime(e.endTime)}`;
      const attendeeList = e.attendees
        ? e.attendees.map((a) => `  - ${a.displayName || a.email} (${a.responseStatus})`).join("\n")
        : "なし";

      const details = [
        `# ${e.summary}`,
        "",
        `- **ID**: #${e.id}`,
        `- **日付**: ${e.date}`,
        `- **時間**: ${time}`,
        `- **場所**: ${e.location || "なし"}`,
        `- **会議リンク**: ${e.conferenceLink || "なし"}`,
        `- **ステータス**: ${e.status}`,
        `- **既読**: ${e.isRead ? "はい" : "いいえ"}`,
        "",
        "## 説明",
        e.description || "(なし)",
        "",
        "## 参加者",
        attendeeList,
      ].join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: details,
          },
        ],
      };
    },
  );

  /**
   * create_calendar_event - イベント作成 (ローカルのみ)
   */
  server.tool(
    "create_calendar_event",
    "新しいカレンダーイベントを作成する (ローカル保存のみ、Google Calendar には同期されない)",
    {
      date: z.string().describe("日付 (YYYY-MM-DD)"),
      summary: z.string().describe("イベントタイトル"),
      startTime: z.string().describe("開始時刻 (ISO8601、例: 2026-02-05T10:00:00+09:00)"),
      endTime: z.string().describe("終了時刻 (ISO8601、例: 2026-02-05T11:00:00+09:00)"),
      description: z.string().optional().describe("イベントの説明"),
      location: z.string().optional().describe("場所"),
      isAllDay: z.boolean().optional().describe("終日イベントかどうか"),
      projectId: z.number().optional().describe("紐づけるプロジェクトID"),
    },
    async ({ date, summary, startTime, endTime, description, location, isAllDay, projectId }) => {
      const response = await apiPost<CalendarEvent>("/calendar", {
        date,
        summary,
        startTime,
        endTime,
        description,
        location,
        isAllDay,
        projectId,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `イベント作成エラー: ${response.error}`,
            },
          ],
        };
      }

      const e = response.data;
      const time = e.isAllDay ? "終日" : `${formatTime(e.startTime)} - ${formatTime(e.endTime)}`;

      return {
        content: [
          {
            type: "text" as const,
            text: `イベントを作成しました:\n- ID: #${e.id}\n- 日付: ${e.date}\n- 時間: ${time}\n- タイトル: ${e.summary}`,
          },
        ],
      };
    },
  );

  /**
   * delete_calendar_event - イベント削除
   */
  server.tool(
    "delete_calendar_event",
    "カレンダーイベントを削除する",
    {
      id: z.number().describe("削除するイベントID"),
    },
    async ({ id }) => {
      const response = await apiDelete<DeleteResponse>(`/calendar/${id}`);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `イベント削除エラー: ${response.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `イベント #${id} を削除しました。`,
          },
        ],
      };
    },
  );

  /**
   * sync_calendar - Google Calendar から同期
   */
  server.tool(
    "sync_calendar",
    "Google Calendar からイベントを同期する",
    {
      calendarId: z.string().optional().describe("同期するカレンダーID (省略時は全カレンダー)"),
    },
    async ({ calendarId }) => {
      const response = await apiPost<SyncResponse>("/calendar/sync", {
        calendarId,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `同期エラー: ${response.error}`,
            },
          ],
        };
      }

      const { message, jobId, calendarId: targetCalendar } = response.data;

      return {
        content: [
          {
            type: "text" as const,
            text: `${message}\n- 対象: ${targetCalendar}${jobId ? `\n- ジョブID: ${jobId}` : ""}`,
          },
        ],
      };
    },
  );

  /**
   * mark_calendar_read - イベントを既読にする
   */
  server.tool(
    "mark_calendar_read",
    "カレンダーイベントを既読にする",
    {
      ids: z.array(z.number()).optional().describe("既読にするイベントIDの配列"),
      date: z.string().optional().describe("日付指定で全て既読 (YYYY-MM-DD)"),
      startDate: z.string().optional().describe("範囲指定の開始日 (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("範囲指定の終了日 (YYYY-MM-DD)"),
      all: z.boolean().optional().describe("全て既読にする場合は true"),
    },
    async ({ ids, date, startDate, endDate, all }) => {
      // 個別ID指定の場合
      if (ids && ids.length > 0) {
        const response = await apiPatch<MarkReadResponse>("/calendar/mark-read", { ids });

        if (!response.ok || !response.data) {
          return {
            content: [
              {
                type: "text" as const,
                text: `既読更新エラー: ${response.error}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `${response.data.updated}件のイベントを既読にしました。`,
            },
          ],
        };
      }

      // 範囲指定の場合
      const body: Record<string, string> = {};
      if (date) body.date = date;
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;

      if (Object.keys(body).length === 0 && !all) {
        return {
          content: [
            {
              type: "text" as const,
              text: "ids, date, startDate/endDate, または all のいずれかを指定してください。",
            },
          ],
        };
      }

      const response = await apiPatch<MarkReadResponse>("/calendar/mark-all-read", body);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `既読更新エラー: ${response.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `${response.data.updated}件のイベントを既読にしました。`,
          },
        ],
      };
    },
  );

  /**
   * get_calendar_stats - 統計取得
   */
  server.tool(
    "get_calendar_stats",
    "カレンダーイベントの統計情報を取得する",
    {
      startDate: z.string().optional().describe("集計開始日 (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("集計終了日 (YYYY-MM-DD)"),
    },
    async ({ startDate, endDate }) => {
      const response = await apiGet<CalendarStats>("/calendar/stats", {
        startDate,
        endDate,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `統計取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const s = response.data;
      const stats = [
        "## カレンダー統計",
        "",
        `- **総数**: ${s.total}件`,
        `- **未読**: ${s.unread}件`,
        `- **既読**: ${s.read}件`,
        "",
        "### ステータス別",
        `- 確定: ${s.byStatus.confirmed}件`,
        `- 仮: ${s.byStatus.tentative}件`,
        `- キャンセル: ${s.byStatus.cancelled}件`,
        "",
        "### その他",
        `- 終日イベント: ${s.allDay}件`,
        `- オンライン会議あり: ${s.withMeeting}件`,
      ].join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: stats,
          },
        ],
      };
    },
  );
}

/**
 * ISO8601 時刻を HH:MM 形式にフォーマット
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}
