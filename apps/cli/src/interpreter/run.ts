import type { createDatabase, TranscriptionSegment } from "@repo/db";
import { schema } from "@repo/db";
import type { ExtractedTerm, RpcInterpretResponse } from "@repo/types";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { loadConfig } from "../config.js";
import { getFeedbackPromptSection } from "../feedback-injector.js";
import { getDateString } from "../utils/date.js";

const CONCURRENCY = 3;

/**
 * セグメント配列に対して interpret を実行し、interpretedText を DB に書き込む。
 * transcribe.ts (自動) と interpret コマンド (手動) の両方から呼ばれる共通処理。
 * CONCURRENCY 個のワーカーで並列処理する Queue 方式。
 */
export async function interpretSegments(
  segments: TranscriptionSegment[],
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<{ success: number; fail: number; termsExtracted: number }> {
  if (segments.length === 0) return { success: 0, fail: 0, termsExtracted: 0 };

  const { url, timeout } = config.worker;
  let success = 0;
  let fail = 0;
  let processed = 0;
  let termsExtracted = 0;

  // フィードバック例を事前に取得 (全セグメントで共有)
  let feedbackExamples: string | undefined;
  try {
    const examples = await getFeedbackPromptSection(db, "interpret");
    if (examples) {
      feedbackExamples = examples;
      consola.info(`[interpret] Loaded feedback examples (${examples.length} chars)`);
    }
  } catch (err) {
    consola.debug("[interpret] Failed to load feedback examples:", err);
  }

  // 既存の vocabulary 用語リストを取得 (重複除外用)
  const existingVocabulary = db
    .select({ term: schema.vocabulary.term })
    .from(schema.vocabulary)
    .all();
  const existingTerms = existingVocabulary.map((v) => v.term);

  // pending 状態の vocabulary_suggestions も除外対象に含める
  const pendingSuggestions = db
    .select({ term: schema.vocabularySuggestions.term })
    .from(schema.vocabularySuggestions)
    .where(eq(schema.vocabularySuggestions.status, "pending"))
    .all();
  const pendingTerms = pendingSuggestions.map((s) => s.term);
  const allExistingTerms = [...new Set([...existingTerms, ...pendingTerms])];

  const queue = [...segments];

  async function processOne(): Promise<void> {
    while (queue.length > 0) {
      const segment = queue.shift();
      if (!segment) break;

      const globalIndex = segments.indexOf(segment);

      // 直前1-2セグメントの transcription をコンテキストとして渡す
      const contextSegments: string[] = [];
      if (globalIndex >= 2) {
        const prev2 = segments[globalIndex - 2];
        if (prev2?.transcription) contextSegments.push(prev2.transcription);
      }
      if (globalIndex >= 1) {
        const prev1 = segments[globalIndex - 1];
        if (prev1?.transcription) contextSegments.push(prev1.transcription);
      }
      const context = contextSegments.length > 0 ? contextSegments.join("\n") : undefined;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${url}/rpc/interpret`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: segment.transcription,
            speaker: segment.speaker ?? undefined,
            context,
            feedbackExamples,
            existingTerms: allExistingTerms,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          consola.warn(`[interpret] Worker returned ${response.status} for segment ${segment.id}`);
          fail++;
          processed++;
          continue;
        }

        const result = (await response.json()) as RpcInterpretResponse;

        db.update(schema.transcriptionSegments)
          .set({ interpretedText: result.interpretedText })
          .where(eq(schema.transcriptionSegments.id, segment.id))
          .run();

        // 抽出された用語を処理
        if (result.extractedTerms && result.extractedTerms.length > 0) {
          const newTermsCount = await processExtractedTerms(
            db,
            result.extractedTerms,
            segment.id,
            segment.date,
            allExistingTerms,
          );
          termsExtracted += newTermsCount;

          // 重複チェック用リストに追加
          for (const term of result.extractedTerms) {
            if (!allExistingTerms.includes(term.term)) {
              allExistingTerms.push(term.term);
            }
          }
        }

        success++;
        processed++;
        const preview = result.interpretedText.slice(0, 50);
        const termInfo =
          result.extractedTerms && result.extractedTerms.length > 0
            ? ` (+${result.extractedTerms.length} terms)`
            : "";
        consola.info(
          `[interpret] [${processed}/${segments.length}] #${segment.id}: ${preview}...${termInfo}`,
        );
      } catch (err) {
        processed++;
        if (controller.signal.aborted) {
          consola.warn(`[interpret] Timeout for segment ${segment.id}`);
        } else {
          consola.warn(`[interpret] Failed for segment ${segment.id}:`, err);
        }
        fail++;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  // CONCURRENCY 個のワーカーを並列起動
  const workers = Array.from({ length: CONCURRENCY }, () => processOne());
  await Promise.all(workers);

  return { success, fail, termsExtracted };
}

/**
 * 抽出された用語を vocabulary_suggestions と tasks に登録する
 */
async function processExtractedTerms(
  db: ReturnType<typeof createDatabase>,
  extractedTerms: ExtractedTerm[],
  segmentId: number,
  segmentDate: string,
  existingTerms: string[],
): Promise<number> {
  let count = 0;

  for (const term of extractedTerms) {
    // 重複チェック (vocabulary と pending の vocabulary_suggestions)
    if (existingTerms.includes(term.term)) {
      continue;
    }

    // confidence が低すぎる場合はスキップ
    if (term.confidence < 0.5) {
      continue;
    }

    try {
      // vocabulary_suggestions に登録
      const suggestion = db
        .insert(schema.vocabularySuggestions)
        .values({
          term: term.term,
          reading: term.reading ?? null,
          category: term.category ?? null,
          reason: term.reason ?? null,
          sourceType: "interpret",
          sourceId: segmentId,
          confidence: term.confidence,
          status: "pending",
        })
        .returning()
        .get();

      // tasks に登録
      const date = getDateString(new Date(segmentDate));
      db.insert(schema.tasks)
        .values({
          date,
          vocabularySuggestionId: suggestion.id,
          sourceType: "vocabulary",
          title: `用語登録: ${term.term}`,
          description: buildTermDescription(term),
          priority: null,
          confidence: term.confidence,
          dueDate: null,
        })
        .run();

      count++;
      consola.debug(`[interpret] Created vocabulary suggestion: ${term.term}`);
    } catch (err) {
      // 重複エラー等は無視
      consola.debug(`[interpret] Failed to create vocabulary suggestion for ${term.term}:`, err);
    }
  }

  return count;
}

/**
 * 用語の説明文を構築
 */
function buildTermDescription(term: ExtractedTerm): string {
  const parts: string[] = [];

  if (term.reading) {
    parts.push(`読み: ${term.reading}`);
  }
  if (term.category) {
    parts.push(`カテゴリ: ${term.category}`);
  }
  if (term.reason) {
    parts.push(`\n抽出理由: ${term.reason}`);
  }

  return parts.length > 0 ? parts.join("\n") : "";
}
