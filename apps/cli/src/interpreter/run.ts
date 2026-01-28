import type { createDatabase, TranscriptionSegment } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { loadConfig } from "../config.js";

const CHUNK_SIZE = 10;

/**
 * セグメント配列に対して interpret を実行し、interpretedText を DB に書き込む。
 * transcribe.ts (自動) と interpret コマンド (手動) の両方から呼ばれる共通処理。
 * タイムアウト対策として CHUNK_SIZE 件ずつ処理する。
 */
export async function interpretSegments(
  segments: TranscriptionSegment[],
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof createDatabase>,
): Promise<{ success: number; fail: number }> {
  if (segments.length === 0) return { success: 0, fail: 0 };

  const { url, timeout } = config.worker;
  const totalChunks = Math.ceil(segments.length / CHUNK_SIZE);

  let success = 0;
  let fail = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, segments.length);
    const chunk = segments.slice(start, end);

    consola.info(
      `[interpret] Processing chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} segments)`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      for (let i = 0; i < chunk.length; i++) {
        const globalIndex = start + i;
        const segment = chunk[i];
        if (!segment) continue;

        // 直前1-2セグメントの transcription をコンテキストとして渡す(全体配列から)
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
            fail++;
            continue;
          }

          const result = (await response.json()) as { interpretedText: string };

          db.update(schema.transcriptionSegments)
            .set({ interpretedText: result.interpretedText })
            .where(eq(schema.transcriptionSegments.id, segment.id))
            .run();

          success++;
          const preview = result.interpretedText.slice(0, 50);
          consola.info(
            `[interpret] [${success + fail}/${segments.length}] #${segment.id}: ${preview}...`,
          );
        } catch (err) {
          if (controller.signal.aborted) {
            consola.error(`[interpret] Chunk ${chunkIndex + 1} timeout exceeded`);
            fail += chunk.length - i;
            break;
          }
          consola.warn(`[interpret] Failed for segment ${segment.id}:`, err);
          fail++;
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { success, fail };
}
