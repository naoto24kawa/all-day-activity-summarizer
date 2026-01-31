/**
 * Extraction Log Utilities
 *
 * 抽出処理 (タスク・学び) の処理済み記録を管理する共通ユーティリティ
 */

import type { AdasDatabase, NewExtractionLog } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { and, eq } from "drizzle-orm";

export type ExtractionType = "task" | "learning" | "vocabulary";
export type ExtractionSourceType =
  | "slack"
  | "github"
  | "github-comment"
  | "memo"
  | "claude-code"
  | "transcription";

/**
 * Check if extraction has already been attempted for this source
 */
export function hasExtractionLog(
  db: AdasDatabase,
  extractionType: ExtractionType,
  sourceType: ExtractionSourceType,
  sourceId: string,
): boolean {
  const existing = db
    .select()
    .from(schema.extractionLogs)
    .where(
      and(
        eq(schema.extractionLogs.extractionType, extractionType),
        eq(schema.extractionLogs.sourceType, sourceType),
        eq(schema.extractionLogs.sourceId, sourceId),
      ),
    )
    .limit(1)
    .all();

  return existing.length > 0;
}

/**
 * Record that extraction was attempted for a source
 */
export function recordExtractionLog(
  db: AdasDatabase,
  extractionType: ExtractionType,
  sourceType: ExtractionSourceType,
  sourceId: string,
  extractedCount: number,
): void {
  try {
    const log: NewExtractionLog = {
      extractionType,
      sourceType,
      sourceId,
      extractedCount,
    };
    db.insert(schema.extractionLogs).values(log).run();
    consola.debug(
      `[extraction-log] Recorded: ${extractionType}/${sourceType}:${sourceId} (${extractedCount} items)`,
    );
  } catch (err) {
    // Ignore unique constraint errors (already logged)
    consola.debug(`[extraction-log] Failed to record:`, err);
  }
}

/**
 * Get extraction log for a source
 */
export function getExtractionLog(
  db: AdasDatabase,
  extractionType: ExtractionType,
  sourceType: ExtractionSourceType,
  sourceId: string,
) {
  return db
    .select()
    .from(schema.extractionLogs)
    .where(
      and(
        eq(schema.extractionLogs.extractionType, extractionType),
        eq(schema.extractionLogs.sourceType, sourceType),
        eq(schema.extractionLogs.sourceId, sourceId),
      ),
    )
    .get();
}
