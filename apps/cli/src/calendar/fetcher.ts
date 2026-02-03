/**
 * Google Calendar Event Fetcher
 *
 * カレンダーイベントの取得と DB 保存を担当
 */

import type { AdasDatabase, NewCalendarEvent } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { CalendarEvent, GoogleCalendarClient } from "./client.js";

/**
 * イベントの開始日時をパース (終日イベント対応)
 */
function parseEventDateTime(event: CalendarEvent): {
  startTime: string;
  endTime: string;
  isAllDay: boolean;
} {
  const isAllDay = Boolean(event.start.date && !event.start.dateTime);

  if (isAllDay) {
    // 終日イベント: date のみ (YYYY-MM-DD)
    // 終日イベントは JST 00:00 として扱う
    return {
      startTime: `${event.start.date}T00:00:00+09:00`,
      endTime: `${event.end.date}T00:00:00+09:00`,
      isAllDay: true,
    };
  }

  // 通常のイベント: dateTime (ISO8601)
  return {
    startTime: event.start.dateTime || "",
    endTime: event.end.dateTime || "",
    isAllDay: false,
  };
}

/**
 * イベントの日付を取得 (YYYY-MM-DD)
 */
function getEventDate(event: CalendarEvent): string {
  if (event.start.date) {
    return event.start.date;
  }

  if (event.start.dateTime) {
    // ISO8601 から日付部分を抽出 (JSTに変換)
    const date = new Date(event.start.dateTime);
    // JST オフセットを適用
    const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return jstDate.toISOString().split("T")[0]!;
  }

  return new Date().toISOString().split("T")[0]!;
}

/**
 * 参加者情報を JSON 文字列に変換
 */
function serializeAttendees(attendees: CalendarEvent["attendees"] | undefined): string | null {
  if (!attendees || attendees.length === 0) {
    return null;
  }

  return JSON.stringify(
    attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName || null,
      responseStatus: a.responseStatus,
    })),
  );
}

/**
 * 主催者情報を JSON 文字列に変換
 */
function serializeOrganizer(organizer: CalendarEvent["organizer"] | undefined): string | null {
  if (!organizer) {
    return null;
  }

  return JSON.stringify({
    email: organizer.email,
    displayName: organizer.displayName || null,
  });
}

/**
 * 会議リンクを抽出
 */
function getConferenceLink(event: CalendarEvent): string | null {
  // Google Meet (hangoutLink)
  if (event.hangoutLink) {
    return event.hangoutLink;
  }

  // 他の会議ツール (conferenceData)
  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find((e) => e.entryPointType === "video");
    if (videoEntry) {
      return videoEntry.uri;
    }
  }

  return null;
}

/**
 * カレンダーイベントを取得して DB に保存
 */
export async function fetchCalendarEvents(
  db: AdasDatabase,
  client: GoogleCalendarClient,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<{ fetchedCount: number; insertedCount: number; updatedCount: number }> {
  let fetchedCount = 0;
  let insertedCount = 0;
  let updatedCount = 0;
  let pageToken: string | undefined;

  do {
    const response = await client.listEvents(calendarId, timeMin, timeMax, pageToken);
    pageToken = response.nextPageToken;

    for (const event of response.items) {
      fetchedCount++;

      // キャンセルされたイベントはスキップ (または削除)
      if (event.status === "cancelled") {
        // 既存のイベントがあれば削除
        await db
          .delete(schema.calendarEvents)
          .where(eq(schema.calendarEvents.eventId, event.id))
          .execute();
        continue;
      }

      const { startTime, endTime, isAllDay } = parseEventDateTime(event);
      const date = getEventDate(event);

      // 既存のイベントをチェック
      const existing = db
        .select()
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.eventId, event.id))
        .get();

      const eventData: Omit<NewCalendarEvent, "id" | "createdAt"> = {
        date,
        eventId: event.id,
        calendarId,
        summary: event.summary || "(無題)",
        description: event.description || null,
        startTime,
        endTime,
        isAllDay,
        location: event.location || null,
        attendees: serializeAttendees(event.attendees),
        organizer: serializeOrganizer(event.organizer),
        conferenceLink: getConferenceLink(event),
        status: event.status as "confirmed" | "tentative" | "cancelled",
        isRead: false,
        projectId: null, // プロジェクト紐付けは後で実装
        syncedAt: new Date().toISOString(),
      };

      if (existing) {
        // 更新
        await db
          .update(schema.calendarEvents)
          .set(eventData)
          .where(eq(schema.calendarEvents.id, existing.id))
          .execute();
        updatedCount++;
      } else {
        // 新規挿入
        await db.insert(schema.calendarEvents).values(eventData).execute();
        insertedCount++;
      }
    }
  } while (pageToken);

  consola.info(
    `Calendar: Fetched ${fetchedCount} events from ${calendarId}, ` +
      `inserted: ${insertedCount}, updated: ${updatedCount}`,
  );

  return { fetchedCount, insertedCount, updatedCount };
}

/**
 * 複数カレンダーのイベントを一括取得
 */
export async function fetchAllCalendarEvents(
  db: AdasDatabase,
  client: GoogleCalendarClient,
  calendarIds: string[],
  daysToFetch: number,
): Promise<{ totalFetched: number; totalInserted: number; totalUpdated: number }> {
  const now = new Date();
  const timeMin = new Date(now.getTime() - daysToFetch * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + daysToFetch * 24 * 60 * 60 * 1000);

  let totalFetched = 0;
  let totalInserted = 0;
  let totalUpdated = 0;

  // カレンダーIDが空の場合はプライマリカレンダーのみ
  const targetCalendarIds = calendarIds.length > 0 ? calendarIds : ["primary"];

  for (const calendarId of targetCalendarIds) {
    try {
      const result = await fetchCalendarEvents(db, client, calendarId, timeMin, timeMax);
      totalFetched += result.fetchedCount;
      totalInserted += result.insertedCount;
      totalUpdated += result.updatedCount;
    } catch (error) {
      consola.error(`Calendar: Failed to fetch events from ${calendarId}:`, error);
    }
  }

  return { totalFetched, totalInserted, totalUpdated };
}
