import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";
import { generateDailySummary, generateTimesSummary } from "../summarizer/scheduler.js";
import { getDateString } from "../utils/date.js";

async function handleTimesSummary(
  db: ReturnType<typeof createDatabase>,
  dateStr: string,
  startHour: number,
  endHour: number,
): Promise<void> {
  consola.info(`Generating times summary for ${dateStr} ${startHour}:00 - ${endHour}:59...`);
  const result = await generateTimesSummary(db, dateStr, startHour, endHour);
  if (result) {
    consola.success("Times summary generated:");
    consola.log(result);
  } else {
    consola.warn("No data found for this time range");
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
    consola.warn("No data found for this date.");
  }
}

export function registerSummarizeCommand(program: Command): void {
  program
    .command("summarize")
    .description("Generate summaries from transcriptions")
    .option("-d, --date <date>", "Date to summarize (YYYY-MM-DD or 'today')", "today")
    .option("--start <hour>", "Start hour for times summary (0-23)")
    .option("--end <hour>", "End hour for times summary (0-23)")
    .option("--daily", "Generate daily summary")
    .action(async (options: { date?: string; start?: string; end?: string; daily?: boolean }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);
      const dateStr = getDateString(options.date);

      // Times summary (指定した時間範囲)
      if (options.start !== undefined && options.end !== undefined) {
        const startHour = Number.parseInt(options.start, 10);
        const endHour = Number.parseInt(options.end, 10);

        if (Number.isNaN(startHour) || startHour < 0 || startHour > 23) {
          consola.error("Start hour must be between 0 and 23");
          return;
        }
        if (Number.isNaN(endHour) || endHour < 0 || endHour > 23) {
          consola.error("End hour must be between 0 and 23");
          return;
        }
        if (startHour > endHour) {
          consola.error("Start hour must be less than or equal to end hour");
          return;
        }
        const timeRange = endHour - startHour + 1;
        if (timeRange > 12) {
          consola.error("Time range must be 12 hours or less");
          return;
        }

        await handleTimesSummary(db, dateStr, startHour, endHour);
        return;
      }

      if (options.daily) {
        await handleDailySummary(db, dateStr);
        return;
      }

      // デフォルトは daily
      await handleDailySummary(db, dateStr);
    });
}
