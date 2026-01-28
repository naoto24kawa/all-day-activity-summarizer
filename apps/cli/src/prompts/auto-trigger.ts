import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { PromptTarget } from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { improvePrompt } from "./improver.js";

const TARGETS: PromptTarget[] = ["interpret", "evaluate", "summarize-hourly", "summarize-daily"];

export async function checkAndAutoImprove(db: AdasDatabase, threshold: number): Promise<void> {
  for (const target of TARGETS) {
    try {
      // 最終改善日時を取得
      const lastImprovement = db
        .select()
        .from(schema.promptImprovements)
        .where(eq(schema.promptImprovements.target, target))
        .orderBy(desc(schema.promptImprovements.createdAt))
        .limit(1)
        .get();

      const sinceDate = lastImprovement?.createdAt ?? "1970-01-01T00:00:00.000Z";

      // 最終改善以降の bad フィードバック数を取得
      const result = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.segmentFeedbacks)
        .where(
          and(
            eq(schema.segmentFeedbacks.target, target),
            eq(schema.segmentFeedbacks.rating, "bad"),
            gte(schema.segmentFeedbacks.createdAt, sinceDate),
          ),
        )
        .get();

      const badCount = result?.count ?? 0;

      if (badCount >= threshold) {
        consola.info(
          `[auto-improve] Target "${target}" has ${badCount} bad feedbacks (threshold: ${threshold}). Triggering improvement...`,
        );
        await improvePrompt(target, db);
      }
    } catch (err) {
      consola.warn(`[auto-improve] Failed to check/improve "${target}":`, err);
    }
  }
}
