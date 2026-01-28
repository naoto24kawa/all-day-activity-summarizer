import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { and, eq, isNull } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { interpretSegments } from "../interpreter/run.js";
import { getDateString } from "../utils/date.js";

export function registerInterpretCommand(program: Command): void {
  program
    .command("interpret")
    .description("Generate AI-interpreted text for transcription segments")
    .option("-d, --date <date>", "Target date (YYYY-MM-DD or 'today')")
    .option("--all", "Process all dates with un-interpreted segments")
    .option("--force", "Re-interpret all segments (including already interpreted)")
    .action(async (opts: { date?: string; all?: boolean; force?: boolean }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      if (!opts.all && !opts.date) {
        opts.date = "today";
      }

      if (opts.all) {
        consola.info(`[interpret] Processing all dates, force: ${!!opts.force}`);
      } else {
        const dateStr = getDateString(opts.date);
        consola.info(`[interpret] Target date: ${dateStr}, force: ${!!opts.force}`);
      }

      const segments = buildQuery(db, opts);

      if (segments.length === 0) {
        consola.info("[interpret] No segments to interpret");
        return;
      }

      consola.info(`[interpret] Found ${segments.length} segments to interpret`);

      const { success, fail } = await interpretSegments(segments, config, db);
      consola.success(`[interpret] Complete: ${success} succeeded, ${fail} failed`);
    });
}

function buildQuery(
  db: ReturnType<typeof createDatabase>,
  opts: { date?: string; all?: boolean; force?: boolean },
) {
  if (opts.all) {
    if (opts.force) {
      return db.select().from(schema.transcriptionSegments).all();
    }
    return db
      .select()
      .from(schema.transcriptionSegments)
      .where(isNull(schema.transcriptionSegments.interpretedText))
      .all();
  }

  const dateStr = getDateString(opts.date);
  if (opts.force) {
    return db
      .select()
      .from(schema.transcriptionSegments)
      .where(eq(schema.transcriptionSegments.date, dateStr))
      .all();
  }
  return db
    .select()
    .from(schema.transcriptionSegments)
    .where(
      and(
        eq(schema.transcriptionSegments.date, dateStr),
        isNull(schema.transcriptionSegments.interpretedText),
      ),
    )
    .all();
}
