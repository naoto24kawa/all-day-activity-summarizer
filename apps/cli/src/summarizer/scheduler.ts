import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { and, between, eq, gte, lte } from "drizzle-orm";
import { getTodayDateString } from "../utils/date.js";
import { generateSummary, getModelName } from "./client.js";
import { buildDailySummaryPrompt, buildHourlySummaryPrompt } from "./prompts.js";

// ---------------------------------------------------------------------------
// Pomodoro summary (30-min intervals)
// ---------------------------------------------------------------------------

export async function generatePomodoroSummary(
  db: AdasDatabase,
  date: string,
  startTime: string,
  endTime: string,
): Promise<string | null> {
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

  // メモも取得
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

  if (segments.length === 0 && memos.length === 0) {
    consola.debug(`No segments or memos found for ${startTime} - ${endTime}`);
    return null;
  }

  // 文字起こしとメモを時系列でマージ
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
  const allEntries = [...segmentEntries, ...memoEntries].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const transcription = allEntries.map((e) => e.text).join("\n\n");

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

  // メモも取得
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

  if (segments.length === 0 && memos.length === 0) {
    consola.debug(`No segments or memos found for ${date} hour ${hour}`);
    return null;
  }

  // 文字起こしとメモを時系列でマージ
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
  const allEntries = [...segmentEntries, ...memoEntries].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const transcription = allEntries.map((e) => e.text).join("\n\n");

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

export async function generateDailySummary(db: AdasDatabase, date: string): Promise<string | null> {
  const hourlySummaries = db
    .select()
    .from(schema.summaries)
    .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, "hourly")))
    .all();

  if (hourlySummaries.length === 0) {
    consola.warn(`No hourly summaries found for ${date}`);
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

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/** 30分間隔の period index (0-47) を返す */
function getCurrentPeriodIndex(now: Date): number {
  return now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
}

/** period index (0-47) から startTime/endTime を返す */
function periodToTimeRange(
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

async function checkPomodoroSummary(
  db: AdasDatabase,
  date: string,
  periodIndex: number,
): Promise<void> {
  const { startTime, endTime } = periodToTimeRange(date, periodIndex);
  try {
    consola.info(`Generating pomodoro summary for ${startTime} - ${endTime}...`);
    const result = await generatePomodoroSummary(db, date, startTime, endTime);
    if (result) {
      consola.success(`Pomodoro summary generated for ${startTime} - ${endTime}`);
    }
  } catch (err) {
    consola.error("Failed to generate pomodoro summary:", err);
  }
}

async function checkHourlySummary(db: AdasDatabase, date: string, hour: number): Promise<void> {
  try {
    consola.info(`Generating hourly summary for ${date} hour ${hour}...`);
    const result = await generateHourlySummary(db, date, hour);
    if (result) {
      consola.success(`Hourly summary generated for hour ${hour}`);
    }
  } catch (err) {
    consola.error("Failed to generate hourly summary:", err);
  }
}

async function checkDailySummary(db: AdasDatabase, date: string): Promise<void> {
  try {
    consola.info(`Generating daily summary for ${date}...`);
    const result = await generateDailySummary(db, date);
    if (result) {
      consola.success(`Daily summary generated for ${date}`);
    }
  } catch (err) {
    consola.error("Failed to generate daily summary:", err);
  }
}

export function startScheduler(db: AdasDatabase): () => void {
  let lastPomodoroPeriod = -1;
  let lastHourlySummaryHour = -1;
  let lastDailySummaryDate = "";

  const interval = setInterval(async () => {
    const now = new Date();
    const date = getTodayDateString();
    const currentPeriod = getCurrentPeriodIndex(now);
    const currentHour = now.getHours();

    // Pomodoro summary: 30分の境界を越えたら前の period を要約
    if (currentPeriod !== lastPomodoroPeriod && currentPeriod > 0) {
      lastPomodoroPeriod = currentPeriod;
      await checkPomodoroSummary(db, date, currentPeriod - 1);
    }

    // Hourly summary: 時間の境界を越えたら前の1時間を要約
    if (currentHour !== lastHourlySummaryHour && currentHour > 0) {
      lastHourlySummaryHour = currentHour;
      await checkHourlySummary(db, date, currentHour - 1);
    }

    // Daily summary: 23:00以降に1日分を生成
    if (currentHour >= 23 && lastDailySummaryDate !== date) {
      lastDailySummaryDate = date;
      await checkDailySummary(db, date);
    }
  }, 60_000); // Check every minute

  return () => clearInterval(interval);
}
