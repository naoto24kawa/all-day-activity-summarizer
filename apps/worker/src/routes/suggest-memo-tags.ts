/**
 * Suggest Memo Tags Route
 *
 * Uses Haiku to suggest appropriate tags for a memo based on its content.
 */

import { runClaude } from "@repo/core";
import type { MemoTag, RpcSuggestMemoTagsRequest, RpcSuggestMemoTagsResponse } from "@repo/types";
import { MEMO_TAGS } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { withProcessingLog } from "../utils/log-processing.js";

const SUGGEST_TAGS_MODEL = "haiku";

export function createSuggestMemoTagsRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<RpcSuggestMemoTagsRequest>();

      if (!body.content || typeof body.content !== "string") {
        return c.json({ error: "content is required" }, 400);
      }

      const result = await withProcessingLog(
        "suggest-tags",
        SUGGEST_TAGS_MODEL,
        () => suggestTagsWithClaude(body.content),
        (res) => ({
          inputSize: body.content.length,
          metadata: {
            suggestedTags: res.tags,
          },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/suggest-memo-tags] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function suggestTagsWithClaude(content: string): Promise<RpcSuggestMemoTagsResponse> {
  const tagDescriptions = [
    "完了: 完了報告、終了したタスク",
    "重要: 緊急、優先度高、期限あり",
    "TODO: やるべきこと、タスク",
    "要確認: 確認が必要、不明点",
    "後で: 後回し、保留",
    "アイデア: 提案、思いつき",
    "問題: バグ、障害、課題",
    "メモ: 単なるメモ、記録",
  ];

  const prompt = `メモの内容を分析し、適切なタグを提案してください。

## 利用可能なタグ
${tagDescriptions.map((d) => `- ${d}`).join("\n")}

## メモ内容
${content}

## 出力形式
JSON のみ (マークダウンなし):
{"tags": ["タグ1", "タグ2"]}

## ルール
- 最大2つまでタグを提案
- 該当なしの場合は空配列 []
- タグは上記リストから選択`;

  consola.info(`[worker/suggest-memo-tags] Suggesting tags for memo (${content.length} chars)`);

  const result = await runClaude(prompt, {
    model: SUGGEST_TAGS_MODEL,
    disableTools: true,
  });

  if (!result) {
    throw new Error("No response from tag suggester");
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    consola.warn(`[worker/suggest-memo-tags] Failed to parse response: ${result}`);
    return { tags: [] };
  }

  const parsed = JSON.parse(jsonMatch[0]) as { tags: string[] };

  // Validate tags against MEMO_TAGS
  const validTags = (parsed.tags || []).filter((tag): tag is MemoTag =>
    MEMO_TAGS.includes(tag as MemoTag),
  );

  // Limit to 2 tags
  const tags = validTags.slice(0, 2);

  consola.info(`[worker/suggest-memo-tags] Suggested tags: ${tags.join(", ") || "(none)"}`);

  return { tags };
}
