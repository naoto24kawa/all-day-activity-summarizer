import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { and, between, eq } from "drizzle-orm";
import { getTodayDateString } from "../utils/date.js";
import { generateSummary, getModelName } from "./client.js";
import { buildDailySummaryPrompt, buildHourlySummaryPrompt } from "./prompts.js";

export async function generateHourlySummary(
  db: AdasDatabase,
  date: string,
  hour: number,
): Promise<string | null> {
  const startTime = `${date}T${String(hour).padStart(2, "0")}:00:00`;
  const endTime = `${date}T${String(hour).padStart(2, "0")}:59:59`;

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

  if (segments.length === 0) {
    consola.debug(`No segments found for ${date} hour ${hour}`);
    return null;
  }

  const transcription = segments.map((s) => `[${s.startTime}] ${s.transcription}`).join("\n\n");

  const prompt = buildHourlySummaryPrompt(transcription);
  const content = await generateSummary(prompt);

  const segmentIds = segments.map((s) => s.id);

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

async function checkHourlySummary(
  db: AdasDatabase,
  date: string,
  currentHour: number,
): Promise<void> {
  const targetHour = currentHour - 1;
  try {
    consola.info(`Generating hourly summary for ${date} hour ${targetHour}...`);
    const result = await generateHourlySummary(db, date, targetHour);
    if (result) {
      consola.success(`Hourly summary generated for hour ${targetHour}`);
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
  let lastHourlySummaryHour = -1;
  let lastDailySummaryDate = "";

  const interval = setInterval(async () => {
    const now = new Date();
    const date = getTodayDateString();
    const currentHour = now.getHours();

    // Hourly summary (run at the start of each hour for the previous hour)
    if (currentHour !== lastHourlySummaryHour && currentHour > 0) {
      lastHourlySummaryHour = currentHour;
      await checkHourlySummary(db, date, currentHour);
    }

    // Daily summary (run after 23:00 for today)
    if (currentHour >= 23 && lastDailySummaryDate !== date) {
      lastDailySummaryDate = date;
      await checkDailySummary(db, date);
    }
  }, 60_000); // Check every minute

  return () => clearInterval(interval);
}
