import type {
  AdasDatabase,
  ClaudeCodeSession,
  Memo,
  SlackMessage,
  TranscriptionSegment,
} from "@repo/db";
import { schema } from "@repo/db";
import { and, between, eq, gte, lte } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { generateSummary, getModelName } from "./client.js";
import { buildDailySummaryPrompt, buildHourlySummaryPrompt } from "./prompts.js";

// ---------------------------------------------------------------------------
// Time utilities (JST)
// ---------------------------------------------------------------------------

/**
 * Convert Slack messageTs to JST time string (HH:MM, 24-hour format)
 */
function slackTsToJstTime(ts: string): string {
  const [seconds] = ts.split(".");
  const utcMs = Number(seconds) * 1000;
  // JST = UTC + 9 hours
  const jstDate = new Date(utcMs + 9 * 60 * 60 * 1000);
  const hours = String(jstDate.getUTCHours()).padStart(2, "0");
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Convert ISO8601 timestamp to JST time string (HH:MM, 24-hour format)
 */
function isoToJstTime(isoString: string): string {
  const date = new Date(isoString);
  // JST = UTC + 9 hours
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const hours = String(jstDate.getUTCHours()).padStart(2, "0");
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * 活動データ (セグメント、メモ、Slack、Claude Code) を時系列でマージして、
 * プロンプト用のテキストを生成する。
 */
function buildActivityText(
  segments: TranscriptionSegment[],
  memos: Memo[],
  slackMessages: SlackMessage[],
  claudeSessions: ClaudeCodeSession[],
): string {
  const sections: string[] = [];

  // 1. 音声文字起こし + メモ
  const segmentEntries = segments.map((s) => {
    // startTime is already in JST format (YYYY-MM-DDTHH:MM:SS)
    const time = s.startTime.split("T")[1]?.slice(0, 5) || "";
    return {
      time: s.startTime,
      text: s.speaker
        ? `[${time}] ${s.speaker}: ${s.transcription}`
        : `[${time}] ${s.transcription}`,
    };
  });
  const memoEntries = memos.map((m) => {
    const time = isoToJstTime(m.createdAt);
    return {
      time: m.createdAt,
      text: `[メモ] [${time}] ${m.content}`,
    };
  });
  const transcriptionData = [...segmentEntries, ...memoEntries]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((e) => e.text)
    .join("\n\n");

  if (transcriptionData) {
    sections.push(`### 音声・メモ\n${transcriptionData}`);
  }

  // 2. Slack メッセージ
  if (slackMessages.length > 0) {
    const slackText = slackMessages
      .map((m) => {
        const typeLabel =
          m.messageType === "mention" ? "メンション" : m.messageType === "dm" ? "DM" : "チャネル";
        const channel = m.channelName || m.channelId;
        const time = slackTsToJstTime(m.messageTs);
        return `[${time}] [${typeLabel}] #${channel} ${m.userName || m.userId}: ${m.text}`;
      })
      .join("\n");
    sections.push(`### Slack\n${slackText}`);
  }

  // 3. Claude Code セッション
  if (claudeSessions.length > 0) {
    const claudeText = claudeSessions
      .map((s) => {
        const time = s.startTime ? isoToJstTime(s.startTime) : "??:??";
        const project = s.projectName || s.projectPath.split("/").pop() || "unknown";
        const summary = s.summary
          ? `: ${s.summary.slice(0, 100)}${s.summary.length > 100 ? "..." : ""}`
          : "";
        return `[${time}] ${project} (user: ${s.userMessageCount}, tool: ${s.toolUseCount})${summary}`;
      })
      .join("\n");
    sections.push(`### Claude Code\n${claudeText}`);
  }

  return sections.join("\n\n");
}

interface ActivityData {
  segments: TranscriptionSegment[];
  memos: Memo[];
  slackMessages: SlackMessage[];
  claudeSessions: ClaudeCodeSession[];
}

/**
 * 指定期間の活動データ (セグメント、メモ、Slack、Claude Code) を取得する。
 */
function fetchActivityData(
  db: AdasDatabase,
  date: string,
  startTime: string,
  endTime: string,
): ActivityData {
  const segments = db
    .select()
    .from(schema.transcriptionSegments)
    .where(
      and(
        eq(schema.transcriptionSegments.date, date),
        between(schema.transcriptionSegments.startTime, startTime, endTime),
      ),
    )
    .all();

  const memos = db
    .select()
    .from(schema.memos)
    .where(
      and(
        eq(schema.memos.date, date),
        gte(schema.memos.createdAt, startTime),
        lte(schema.memos.createdAt, endTime),
      ),
    )
    .all();

  // サマリーには自分に関係するメッセージのみ含める
  // - 自分へのメンション (mention)
  // - DM (dm)
  // - 自分が送信したメッセージ (userId が一致)
  const config = loadConfig();
  const myUserId = config.slack.userId;
  const slackMessages = db
    .select()
    .from(schema.slackMessages)
    .where(
      and(
        eq(schema.slackMessages.date, date),
        gte(schema.slackMessages.createdAt, startTime),
        lte(schema.slackMessages.createdAt, endTime),
      ),
    )
    .all()
    .filter(
      (m) =>
        m.messageType === "mention" ||
        m.messageType === "dm" ||
        (myUserId && m.userId === myUserId),
    );

  const claudeSessions = db
    .select()
    .from(schema.claudeCodeSessions)
    .where(
      and(
        eq(schema.claudeCodeSessions.date, date),
        gte(schema.claudeCodeSessions.startTime, startTime),
        lte(schema.claudeCodeSessions.startTime, endTime),
      ),
    )
    .all();

  return { segments, memos, slackMessages, claudeSessions };
}

/** period index (0-47) から startTime/endTime を返す */
export function periodToTimeRange(
  date: string,
  periodIndex: number,
): { startTime: string; endTime: string } {
  const hour = Math.floor(periodIndex / 2);
  const isSecondHalf = periodIndex % 2 === 1;
  const hh = String(hour).padStart(2, "0");

  if (isSecondHalf) {
    return {
      startTime: `${date}T${hh}:30:00`,
      endTime: `${date}T${hh}:59:59`,
    };
  }
  return {
    startTime: `${date}T${hh}:00:00`,
    endTime: `${date}T${hh}:29:59`,
  };
}

// ---------------------------------------------------------------------------
// Pomodoro summary (30-min intervals)
// ---------------------------------------------------------------------------

/**
 * 30分間隔 (ポモドーロ) の要約を生成する。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @param startTime - 期間開始時刻 (ISO8601形式)
 * @param endTime - 期間終了時刻 (ISO8601形式)
 * @returns 生成された要約テキスト、データがない場合は null
 */
export async function generatePomodoroSummary(
  db: AdasDatabase,
  date: string,
  startTime: string,
  endTime: string,
): Promise<string | null> {
  const { segments, memos, slackMessages, claudeSessions } = fetchActivityData(
    db,
    date,
    startTime,
    endTime,
  );

  const hasData =
    segments.length > 0 ||
    memos.length > 0 ||
    slackMessages.length > 0 ||
    claudeSessions.length > 0;

  if (!hasData) {
    return null;
  }

  const activityText = buildActivityText(segments, memos, slackMessages, claudeSessions);
  const prompt = buildHourlySummaryPrompt(activityText);
  const content = await generateSummary(prompt);
  const segmentIds = segments.map((s) => s.id);

  // 同じ期間の既存サマリーを削除してから挿入(上書き)
  db.delete(schema.summaries)
    .where(
      and(
        eq(schema.summaries.date, date),
        eq(schema.summaries.summaryType, "pomodoro"),
        eq(schema.summaries.periodStart, startTime),
        eq(schema.summaries.periodEnd, endTime),
      ),
    )
    .run();

  db.insert(schema.summaries)
    .values({
      date,
      periodStart: startTime,
      periodEnd: endTime,
      summaryType: "pomodoro",
      content,
      segmentIds: JSON.stringify(segmentIds),
      model: getModelName(),
    })
    .run();

  return content;
}

// ---------------------------------------------------------------------------
// Hourly summary (1-hour, aggregates pomodoro summaries)
// ---------------------------------------------------------------------------

/**
 * 1時間単位の要約を生成する。
 * ポモドーロ要約が存在する場合はそれを集約し、
 * 存在しない場合はセグメントから直接生成する。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @param hour - 対象時間 (0-23)
 * @returns 生成された要約テキスト、データがない場合は null
 */
export async function generateHourlySummary(
  db: AdasDatabase,
  date: string,
  hour: number,
): Promise<string | null> {
  const hh = String(hour).padStart(2, "0");
  const startTime = `${date}T${hh}:00:00`;
  const endTime = `${date}T${hh}:59:59`;

  // Prefer aggregating pomodoro summaries if they exist
  const pomodoroSummaries = db
    .select()
    .from(schema.summaries)
    .where(
      and(
        eq(schema.summaries.date, date),
        eq(schema.summaries.summaryType, "pomodoro"),
        between(schema.summaries.periodStart, startTime, endTime),
      ),
    )
    .all();

  if (pomodoroSummaries.length > 0) {
    const summariesText = pomodoroSummaries
      .map((s) => `### ${s.periodStart} - ${s.periodEnd}\n${s.content}`)
      .join("\n\n");

    const prompt = buildHourlySummaryPrompt(summariesText);
    const content = await generateSummary(prompt);
    const allSegmentIds = pomodoroSummaries.flatMap((s) => JSON.parse(s.segmentIds) as number[]);

    // 同じ期間の既存サマリーを削除してから挿入(上書き)
    db.delete(schema.summaries)
      .where(
        and(
          eq(schema.summaries.date, date),
          eq(schema.summaries.summaryType, "hourly"),
          eq(schema.summaries.periodStart, startTime),
          eq(schema.summaries.periodEnd, endTime),
        ),
      )
      .run();

    db.insert(schema.summaries)
      .values({
        date,
        periodStart: startTime,
        periodEnd: endTime,
        summaryType: "hourly",
        content,
        segmentIds: JSON.stringify(allSegmentIds),
        model: getModelName(),
      })
      .run();

    return content;
  }

  // Fallback: generate directly from activity data
  const { segments, memos, slackMessages, claudeSessions } = fetchActivityData(
    db,
    date,
    startTime,
    endTime,
  );

  const hasData =
    segments.length > 0 ||
    memos.length > 0 ||
    slackMessages.length > 0 ||
    claudeSessions.length > 0;

  if (!hasData) {
    return null;
  }

  const activityText = buildActivityText(segments, memos, slackMessages, claudeSessions);
  const prompt = buildHourlySummaryPrompt(activityText);
  const content = await generateSummary(prompt);
  const segmentIds = segments.map((s) => s.id);

  // 同じ期間の既存サマリーを削除してから挿入(上書き)
  db.delete(schema.summaries)
    .where(
      and(
        eq(schema.summaries.date, date),
        eq(schema.summaries.summaryType, "hourly"),
        eq(schema.summaries.periodStart, startTime),
        eq(schema.summaries.periodEnd, endTime),
      ),
    )
    .run();

  db.insert(schema.summaries)
    .values({
      date,
      periodStart: startTime,
      periodEnd: endTime,
      summaryType: "hourly",
      content,
      segmentIds: JSON.stringify(segmentIds),
      model: getModelName(),
    })
    .run();

  return content;
}

// ---------------------------------------------------------------------------
// Daily summary (aggregates hourly summaries)
// ---------------------------------------------------------------------------

/**
 * 日次要約を生成する。
 * 1時間単位の要約を集約して生成する。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @returns 生成された要約テキスト、データがない場合は null
 */
export async function generateDailySummary(db: AdasDatabase, date: string): Promise<string | null> {
  const hourlySummaries = db
    .select()
    .from(schema.summaries)
    .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, "hourly")))
    .all();

  if (hourlySummaries.length === 0) {
    return null;
  }

  const summariesText = hourlySummaries
    .map((s) => `### ${s.periodStart} - ${s.periodEnd}\n${s.content}`)
    .join("\n\n");

  const prompt = buildDailySummaryPrompt(summariesText);
  const content = await generateSummary(prompt);
  const allSegmentIds = hourlySummaries.flatMap((s) => JSON.parse(s.segmentIds) as number[]);

  // 同じ日の既存 daily サマリーを削除してから挿入(上書き)
  db.delete(schema.summaries)
    .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, "daily")))
    .run();

  db.insert(schema.summaries)
    .values({
      date,
      periodStart: `${date}T00:00:00`,
      periodEnd: `${date}T23:59:59`,
      summaryType: "daily",
      content,
      segmentIds: JSON.stringify(allSegmentIds),
      model: getModelName(),
    })
    .run();

  return content;
}
