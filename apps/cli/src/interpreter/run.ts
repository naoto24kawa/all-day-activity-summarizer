import { getFeedbackPromptSection } from "@repo/core";
import type { createDatabase, TranscriptionSegment } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { loadConfig } from "../config.js";

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
): Promise<{ success: number; fail: number }> {
  if (segments.length === 0) return { success: 0, fail: 0 };

  const { url, timeout } = config.worker;
  let success = 0;
  let fail = 0;
  let processed = 0;

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
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          consola.warn(`[interpret] Worker returned ${response.status} for segment ${segment.id}`);
          fail++;
          processed++;
          continue;
        }

        const result = (await response.json()) as { interpretedText: string };

        db.update(schema.transcriptionSegments)
          .set({ interpretedText: result.interpretedText })
          .where(eq(schema.transcriptionSegments.id, segment.id))
          .run();

        success++;
        processed++;
        const preview = result.interpretedText.slice(0, 50);
        consola.info(`[interpret] [${processed}/${segments.length}] #${segment.id}: ${preview}...`);
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

  return { success, fail };
}
