import type { createDatabase, TranscriptionSegment } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { loadConfig } from "../config.js";

/**
 * セグメント配列に対して interpret を実行し、interpretedText を DB に書き込む。
 * transcribe.ts (自動) と interpret コマンド (手動) の両方から呼ばれる共通処理。
 */
export async function interpretSegments(
  segments: TranscriptionSegment[],
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<{ success: number; fail: number }> {
  if (segments.length === 0) return { success: 0, fail: 0 };

  const { url, timeout } = config.worker;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let success = 0;
  let fail = 0;

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
          consola.warn(`[interpret] Worker returned ${response.status} for segment ${segment.id}`);
          fail++;
          continue;
        }

        const result = (await response.json()) as { interpretedText: string };

        db.update(schema.transcriptionSegments)
          .set({ interpretedText: result.interpretedText })
          .where(eq(schema.transcriptionSegments.id, segment.id))
          .run();

        success++;
        consola.debug(`[interpret] Segment ${segment.id} done (${success}/${segments.length})`);
      } catch (err) {
        if (controller.signal.aborted) {
          consola.error("[interpret] Timeout exceeded");
          break;
        }
        consola.warn(`[interpret] Failed for segment ${segment.id}:`, err);
        fail++;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return { success, fail };
}
