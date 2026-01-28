import type { AdasDatabase, Memo, TranscriptionSegment } from "@repo/db";
import { schema } from "@repo/db";
import { and, between, eq, gte, lte } from "drizzle-orm";
import { generateSummary, getModelName } from "./client.js";
import { buildDailySummaryPrompt, buildHourlySummaryPrompt } from "./prompts.js";

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * 文字起こしセグメントとメモを時系列でマージして、
 * プロンプト用のテキストを生成する。
 *
 * @param segments - 文字起こしセグメントの配列
 * @param memos - メモの配列
 * @returns マージされたテキスト
 */
function buildTranscriptionText(segments: TranscriptionSegment[], memos: Memo[]): string {
  const segmentEntries = segments.map((s) => ({
    time: s.startTime,
    text: s.speaker
      ? `[${s.startTime}] ${s.speaker}: ${s.transcription}`
      : `[${s.startTime}] ${s.transcription}`,
  }));
  const memoEntries = memos.map((m) => ({
    time: m.createdAt,
    text: `[メモ] [${m.createdAt}] ${m.content}`,
  }));
  return [...segmentEntries, ...memoEntries]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((e) => e.text)
    .join("\n\n");
}

/**
 * 指定期間のセグメントとメモを取得する。
 */
function fetchSegmentsAndMemos(
  db: AdasDatabase,
  date: string,
  startTime: string,
  endTime: string,
): { segments: TranscriptionSegment[]; memos: Memo[] } {
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

  return { segments, memos };
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
  const { segments, memos } = fetchSegmentsAndMemos(db, date, startTime, endTime);

  if (segments.length === 0 && memos.length === 0) {
    return null;
  }

  const transcription = buildTranscriptionText(segments, memos);
  const prompt = buildHourlySummaryPrompt(transcription);
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

  // Fallback: generate directly from transcription segments
  const { segments, memos } = fetchSegmentsAndMemos(db, date, startTime, endTime);

  if (segments.length === 0 && memos.length === 0) {
    return null;
  }

  const transcription = buildTranscriptionText(segments, memos);
  const prompt = buildHourlySummaryPrompt(transcription);
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
