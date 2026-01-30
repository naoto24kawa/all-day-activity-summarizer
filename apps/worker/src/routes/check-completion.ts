/**
 * Task Completion Check Route
 *
 * Uses Sonnet to determine if a task has been completed
 * based on context from various sources (Claude Code, Slack, Transcribe).
 */

import { runClaude } from "@repo/core";
import type { CheckCompletionRequest, CheckCompletionResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { withProcessingLog } from "../utils/log-processing.js";

const COMPLETION_CHECK_MODEL = "sonnet";

export function createCheckCompletionRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<CheckCompletionRequest>();

      if (!body.task?.title || !body.context || !body.source) {
        return c.json({ error: "task.title, context, and source are required" }, 400);
      }

      const result = await withProcessingLog(
        "check-completion",
        COMPLETION_CHECK_MODEL,
        () => checkCompletionWithClaude(body),
        (res) => ({
          inputSize: body.context.length,
          metadata: {
            source: body.source,
            completed: res.completed,
            confidence: res.confidence,
          },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/check-completion] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function checkCompletionWithClaude(
  req: CheckCompletionRequest,
): Promise<CheckCompletionResponse> {
  const sourceDescriptions: Record<string, string> = {
    "claude-code": "Claude Code セッションのメッセージログ",
    slack: "Slack のメッセージ履歴",
    transcribe: "音声書き起こしテキスト",
  };

  const prompt = `あなたはタスク完了判定の専門家です。

## タスク情報
タイトル: ${req.task.title}
${req.task.description ? `説明: ${req.task.description}` : ""}

## コンテキスト (${sourceDescriptions[req.source]})
${req.context}

## 判定基準
以下のいずれかに該当する場合、タスクは「完了」と判断してください:
- 明示的な完了報告 (「完了しました」「done」「終わった」など)
- タスク内容が実行されたことを示す記述
- タスクの目的が達成されたことを示す記述
- 問題が解決されたことを示す記述

以下の場合は「未完了」と判断してください:
- タスクについての言及がない
- 作業中・進行中を示す記述のみ
- タスクと無関係な内容のみ

## 出力形式
以下の JSON 形式で回答してください (マークダウン記法なし):
{
  "completed": true | false,
  "confidence": 0.0-1.0,
  "reason": "判定理由を日本語で簡潔に",
  "evidence": "完了を示す具体的な文言 (完了の場合のみ、なければ null)"
}`;

  consola.info(
    `[worker/check-completion] Checking task completion: "${req.task.title}" (source: ${req.source})`,
  );

  const result = await runClaude(prompt, {
    model: COMPLETION_CHECK_MODEL,
    disableTools: true,
  });

  if (!result) {
    throw new Error("No response from completion checker");
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse completion check response: ${result}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as CheckCompletionResponse;

  // バリデーション
  if (typeof parsed.completed !== "boolean") {
    parsed.completed = false;
  }
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
    parsed.confidence = 0.5;
  }
  if (typeof parsed.reason !== "string") {
    parsed.reason = "判定理由不明";
  }

  consola.info(
    `[worker/check-completion] Result: ${parsed.completed ? "COMPLETED" : "NOT COMPLETED"} (confidence: ${parsed.confidence}) - ${parsed.reason}`,
  );

  return parsed;
}
