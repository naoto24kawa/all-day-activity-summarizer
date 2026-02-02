/**
 * Vocabulary Generate Readings Handler
 *
 * 読みがない用語に対して読みを生成
 * 1. Kuromoji (Local Worker) で読みを取得
 * 2. 取れなかった場合は AI Worker (LM Studio → Claude) で補完
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq, isNull } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import type { JobResult } from "../worker.js";

interface ReadingResult {
  term: string;
  reading: string | null;
}

export async function handleVocabularyGenerateReadings(
  db: AdasDatabase,
  config: AdasConfig,
  _params: Record<string, unknown>,
): Promise<JobResult> {
  // 読みがない用語を取得
  const termsWithoutReading = db
    .select()
    .from(schema.vocabulary)
    .where(isNull(schema.vocabulary.reading))
    .all();

  if (termsWithoutReading.length === 0) {
    return {
      success: true,
      resultSummary: "読みが設定されていない用語はありません",
      data: { updated: 0, total: 0 },
    };
  }

  const termStrings = termsWithoutReading.map((t) => t.term);
  consola.info(`[vocabulary/generate-readings] Processing ${termStrings.length} terms...`);

  // Step 1: Kuromoji (Local Worker) で読みを取得
  let kuromojiResults: ReadingResult[] = [];
  try {
    const kuromojiResponse = await fetch(`${config.localWorker.url}/rpc/get-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: termStrings }),
      signal: AbortSignal.timeout(config.localWorker.timeout),
    });

    if (kuromojiResponse.ok) {
      const kuromojiData = (await kuromojiResponse.json()) as { results: ReadingResult[] };
      kuromojiResults = kuromojiData.results;
      consola.info(
        `[vocabulary/generate-readings] Kuromoji: ${kuromojiResults.filter((r) => r.reading).length}/${termStrings.length} readings found`,
      );
    }
  } catch (err) {
    consola.warn(
      "[vocabulary/generate-readings] Kuromoji failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // Kuromoji で読みが取れた用語を DB に反映
  const kuromojiUpdated: string[] = [];
  const now = new Date().toISOString();

  for (const result of kuromojiResults) {
    if (result.reading) {
      const term = termsWithoutReading.find((t) => t.term === result.term);
      if (term) {
        db.update(schema.vocabulary)
          .set({ reading: result.reading, updatedAt: now })
          .where(eq(schema.vocabulary.id, term.id))
          .run();
        kuromojiUpdated.push(result.term);
      }
    }
  }

  // Step 2: Kuromoji で読みが取れなかった用語を AI Worker で補完
  const missingTerms = termStrings.filter(
    (t) => !kuromojiResults.find((r) => r.term === t && r.reading),
  );

  const aiUpdated: string[] = [];
  if (missingTerms.length > 0) {
    consola.info(`[vocabulary/generate-readings] AI fallback for ${missingTerms.length} terms...`);

    try {
      const aiResponse = await fetch(`${config.worker.url}/rpc/generate-readings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: missingTerms }),
        signal: AbortSignal.timeout(config.worker.timeout),
      });

      if (aiResponse.ok) {
        const aiData = (await aiResponse.json()) as { results: ReadingResult[] };

        for (const result of aiData.results) {
          if (result.reading) {
            const term = termsWithoutReading.find((t) => t.term === result.term);
            if (term) {
              db.update(schema.vocabulary)
                .set({ reading: result.reading, updatedAt: now })
                .where(eq(schema.vocabulary.id, term.id))
                .run();
              aiUpdated.push(result.term);
            }
          }
        }

        consola.info(
          `[vocabulary/generate-readings] AI: ${aiUpdated.length}/${missingTerms.length} readings generated`,
        );
      }
    } catch (err) {
      consola.warn(
        "[vocabulary/generate-readings] AI Worker failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const totalUpdated = kuromojiUpdated.length + aiUpdated.length;
  consola.info(
    `[vocabulary/generate-readings] Done: ${totalUpdated}/${termStrings.length} updated`,
  );

  return {
    success: true,
    resultSummary:
      totalUpdated > 0
        ? `${totalUpdated}件の読みを設定しました (Kuromoji: ${kuromojiUpdated.length}, AI: ${aiUpdated.length})`
        : "読みを生成できませんでした",
    data: {
      updated: totalUpdated,
      total: termStrings.length,
      kuromoji: kuromojiUpdated.length,
      ai: aiUpdated.length,
    },
  };
}
