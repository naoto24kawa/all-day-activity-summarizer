/**
 * Memo Tag Suggester
 *
 * Calls the Worker RPC to suggest tags for memo content.
 */

import type { MemoTag, RpcSuggestMemoTagsResponse } from "@repo/types";
import consola from "consola";
import { loadConfig } from "../config.js";

/**
 * Suggest tags for memo content using AI
 *
 * @param content - The memo content to analyze
 * @returns Array of suggested tags (max 2)
 */
export async function suggestMemoTags(content: string): Promise<MemoTag[]> {
  const config = loadConfig();
  const { url, timeout } = config.worker;

  consola.info(`[tag-suggester] Requesting tag suggestions from ${url}/rpc/suggest-memo-tags`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/rpc/suggest-memo-tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Worker returned ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as RpcSuggestMemoTagsResponse;

    consola.info(
      `[tag-suggester] Suggested tags: ${result.tags.length > 0 ? result.tags.join(", ") : "(none)"}`,
    );

    return result.tags;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      consola.warn("[tag-suggester] Request timed out");
    } else {
      consola.warn("[tag-suggester] Failed to get tag suggestions:", err);
    }
    // Return empty array on error (don't block memo creation)
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
