import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";
import {
  generateDailySummary,
  generateHourlySummary,
  generatePomodoroSummary,
} from "../summarizer/scheduler.js";
import { getDateString } from "../utils/date.js";

async function handleHourlySummary(
  db: ReturnType<typeof createDatabase>,
  dateStr: string,
  hourStr: string,
): Promise<void> {
  const hour = Number.parseInt(hourStr, 10);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) {
    consola.error("Hour must be between 0 and 23");
    return;
  }

  consola.info(`Generating hourly summary for ${dateStr} hour ${hour}...`);
  const result = await generateHourlySummary(db, dateStr, hour);
  if (result) {
    consola.success("Hourly summary generated:");
    consola.log(result);
  } else {
    consola.warn("No transcription data found for this hour");
  }
}

async function handleDailySummary(
  db: ReturnType<typeof createDatabase>,
  dateStr: string,
): Promise<void> {
  consola.info(`Generating daily summary for ${dateStr}...`);
  const result = await generateDailySummary(db, dateStr);
  if (result) {
    consola.success("Daily summary generated:");
    consola.log(result);
  } else {
    consola.warn("No hourly summaries found. Generate hourly summaries first.");
  }
}

async function handleAllSummaries(
  db: ReturnType<typeof createDatabase>,
  dateStr: string,
): Promise<void> {
  consola.info(`Generating all summaries for ${dateStr}...`);

  // Generate pomodoro summaries (30-min intervals)
  for (let period = 0; period < 48; period++) {
    const hour = Math.floor(period / 2);
    const isSecondHalf = period % 2 === 1;
    const hh = String(hour).padStart(2, "0");
    const startTime = isSecondHalf ? `${dateStr}T${hh}:30:00` : `${dateStr}T${hh}:00:00`;
    const endTime = isSecondHalf ? `${dateStr}T${hh}:59:59` : `${dateStr}T${hh}:29:59`;
    const result = await generatePomodoroSummary(db, dateStr, startTime, endTime);
    if (result) {
      consola.success(`Pomodoro ${startTime} - ${endTime} summary generated`);
    }
  }

  // Generate hourly summaries (aggregating pomodoro)
  for (let hour = 0; hour < 24; hour++) {
    const result = await generateHourlySummary(db, dateStr, hour);
    if (result) {
      consola.success(`Hour ${hour} summary generated`);
    }
  }

  const dailyResult = await generateDailySummary(db, dateStr);
  if (dailyResult) {
    consola.success("Daily summary generated:");
    consola.log(dailyResult);
  }
}

export function registerSummarizeCommand(program: Command): void {
  program
    .command("summarize")
    .description("Generate summaries from transcriptions")
    .option("-d, --date <date>", "Date to summarize (YYYY-MM-DD or 'today')", "today")
    .option("--hour <hour>", "Generate summary for a specific hour (0-23)")
    .option("--daily", "Generate daily summary")
    .action(async (options: { date?: string; hour?: string; daily?: boolean }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);
      const dateStr = getDateString(options.date);

      if (options.hour !== undefined) {
        await handleHourlySummary(db, dateStr, options.hour);
        return;
      }

      if (options.daily) {
        await handleDailySummary(db, dateStr);
        return;
      }

      await handleAllSummaries(db, dateStr);
    });
}
