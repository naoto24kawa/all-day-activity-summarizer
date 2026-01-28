import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { and, eq, isNull } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { getDateString } from "../utils/date.js";

export function registerInterpretCommand(program: Command): void {
  program
    .command("interpret")
    .description("Generate AI-interpreted text for transcription segments")
    .option("-d, --date <date>", "Target date (YYYY-MM-DD or 'today')", "today")
    .option("--force", "Re-interpret all segments (including already interpreted)")
    .action(async (opts: { date: string; force?: boolean }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);
      const dateStr = getDateString(opts.date);

      consola.info(`[interpret] Target date: ${dateStr}, force: ${!!opts.force}`);

      const segments = opts.force
        ? db
            .select()
            .from(schema.transcriptionSegments)
            .where(eq(schema.transcriptionSegments.date, dateStr))
            .all()
        : db
            .select()
            .from(schema.transcriptionSegments)
            .where(
              and(
                eq(schema.transcriptionSegments.date, dateStr),
                isNull(schema.transcriptionSegments.interpretedText),
              ),
            )
            .all();

      if (segments.length === 0) {
        consola.info("[interpret] No segments to interpret");
        return;
      }

      consola.info(`[interpret] Found ${segments.length} segments to interpret`);

      const { url, timeout } = config.worker;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let successCount = 0;
      let failCount = 0;

      try {
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i]!;

          // 直前1-2セグメントの transcription をコンテキストとして渡す
          const contextSegments: string[] = [];
          if (i >= 2 && segments[i - 2]?.transcription) {
            contextSegments.push(segments[i - 2]!.transcription);
          }
          if (i >= 1 && segments[i - 1]?.transcription) {
            contextSegments.push(segments[i - 1]!.transcription);
          }
          const context = contextSegments.length > 0 ? contextSegments.join("\n") : undefined;

          try {
            const response = await fetch(`${url}/rpc/interpret`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: segment.transcription,
                speaker: segment.speaker ?? undefined,
                context,
              }),
              signal: controller.signal,
            });

            if (!response.ok) {
              consola.warn(
                `[interpret] Worker returned ${response.status} for segment ${segment.id}`,
              );
              failCount++;
              continue;
            }

            const result = (await response.json()) as { interpretedText: string };

            db.update(schema.transcriptionSegments)
              .set({ interpretedText: result.interpretedText })
              .where(eq(schema.transcriptionSegments.id, segment.id))
              .run();

            successCount++;
            consola.debug(
              `[interpret] Segment ${segment.id} done (${successCount}/${segments.length})`,
            );
          } catch (err) {
            if (controller.signal.aborted) {
              consola.error("[interpret] Timeout exceeded");
              break;
            }
            consola.warn(`[interpret] Failed for segment ${segment.id}:`, err);
            failCount++;
          }
        }

        consola.success(`[interpret] Complete: ${successCount} succeeded, ${failCount} failed`);
      } finally {
        clearTimeout(timeoutId);
      }
    });
}
