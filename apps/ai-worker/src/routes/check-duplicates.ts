/**
 * Task Duplicate Detection Route
 *
 * Uses Claude to detect duplicate tasks among accepted tasks
 */

import { runClaude } from "@repo/core";
import type {
  CheckDuplicatesRequest,
  CheckDuplicatesResponse,
  DuplicateTaskPair,
} from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { withProcessingLog } from "../utils/log-processing.js";

const DUPLICATE_CHECK_MODEL = "haiku";

export function createCheckDuplicatesRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<CheckDuplicatesRequest>();

      if (!body.tasks || body.tasks.length < 2) {
        return c.json({ duplicates: [] } satisfies CheckDuplicatesResponse);
      }

      const result = await withProcessingLog(
        "check-completion", // Re-use existing process type for logging
        DUPLICATE_CHECK_MODEL,
        () => checkDuplicatesWithClaude(body),
        (res) => ({
          inputSize: body.tasks.length,
          outputSize: res.duplicates.length,
          metadata: {
            minSimilarity: body.minSimilarity ?? 0.7,
            taskCount: body.tasks.length,
          },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/check-duplicates] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function checkDuplicatesWithClaude(
  req: CheckDuplicatesRequest,
): Promise<CheckDuplicatesResponse> {
  const minSimilarity = req.minSimilarity ?? 0.7;

  // Build task list for prompt
  const taskListText = req.tasks
    .map((t) => {
      let text = `- ID: ${t.id}\n  タイトル: ${t.title}`;
      if (t.description) {
        text += `\n  説明: ${t.description.slice(0, 200)}${t.description.length > 200 ? "..." : ""}`;
      }
      return text;
    })
    .join("\n\n");

  const prompt = `あなたはタスク重複検出の専門家です。

## タスク一覧
${taskListText}

## 判定基準
以下のいずれかに該当する場合、タスクは「重複」と判断してください:

1. **同一タスク**: タイトルや内容がほぼ同じ
   - 表記揺れ (ひらがな/カタカナ/漢字)
   - 軽微な文言の違い

2. **包含関係**: 一方のタスクが他方を含む
   - 「Aを実装する」と「Aの機能を追加する」
   - 大きなタスクと、その一部を表すタスク

3. **同一ゴール**: 異なる表現だが同じ目的
   - 「バグ修正」と「エラー対応」(同じ問題を指す場合)
   - 異なる言い回しで同じことを指している

## 出力形式
以下の JSON 形式で回答してください (マークダウン記法なし):
{
  "duplicates": [
    {
      "taskAId": <タスクAのID>,
      "taskATitle": "<タスクAのタイトル>",
      "taskBId": <タスクBのID>,
      "taskBTitle": "<タスクBのタイトル>",
      "similarity": <類似度 0.0-1.0>,
      "reason": "<重複と判断した理由を日本語で簡潔に>",
      "mergedTitle": "<統合後のタイトル案>",
      "mergedDescription": "<統合後の説明案 (null可)>"
    }
  ]
}

注意:
- 類似度が ${minSimilarity} 以上のペアのみを出力してください
- 重複がない場合は空配列を返してください
- 同じタスクが複数のペアに含まれても構いません
- 統合後のタイトルは、両方のタスクの意図を汲んだ簡潔なものにしてください`;

  consola.info(
    `[worker/check-duplicates] Checking duplicates for ${req.tasks.length} tasks (minSimilarity: ${minSimilarity})`,
  );

  const result = await runClaude(prompt, {
    model: DUPLICATE_CHECK_MODEL,
    disableTools: true,
  });

  if (!result) {
    throw new Error("No response from duplicate checker");
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    consola.warn(`[worker/check-duplicates] Failed to parse response: ${result}`);
    return { duplicates: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { duplicates: DuplicateTaskPair[] };

    // Validate and filter
    const validDuplicates = (parsed.duplicates || []).filter((dup) => {
      return (
        typeof dup.taskAId === "number" &&
        typeof dup.taskBId === "number" &&
        typeof dup.similarity === "number" &&
        dup.similarity >= minSimilarity &&
        typeof dup.reason === "string" &&
        typeof dup.mergedTitle === "string"
      );
    });

    consola.info(`[worker/check-duplicates] Found ${validDuplicates.length} duplicate pairs`);

    return { duplicates: validDuplicates };
  } catch (err) {
    consola.warn(`[worker/check-duplicates] JSON parse error: ${err}`);
    return { duplicates: [] };
  }
}
