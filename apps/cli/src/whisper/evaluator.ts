import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { RpcEvaluateResponse, SegmentEvaluation } from "@repo/types";
import consola from "consola";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";

export interface EvaluationResult {
  judgment: "hallucination" | "legitimate" | "mixed";
  confidence: number;
  reason: string;
  suggestedPattern: string | null;
  segmentEvaluations?: SegmentEvaluation[];
}

/**
 * Worker 経由で文字起こし結果を評価し、ハルシネーションかどうか判定する。
 * 既存パターンを通過したテキストのみに使用する(第2段階フィルタ)。
 * DB ログ保存は常にローカル(Mac)側で実行。
 */
export async function evaluateTranscription(
  text: string,
  segments: { text: string; start: number; end: number; speaker?: string }[],
  options?: { db?: AdasDatabase; date?: string; audioFilePath?: string },
): Promise<EvaluationResult> {
  const config = loadConfig();
  const { url, timeout } = config.worker;

  consola.info(`[worker] Sending evaluation to ${url}/rpc/evaluate`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let result: EvaluationResult;

  try {
    const response = await fetch(`${url}/rpc/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, segments }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Worker returned ${response.status}: ${errorBody}`);
    }

    result = (await response.json()) as RpcEvaluateResponse;

    consola.info(
      `[evaluator] Result: ${result.judgment} (confidence: ${result.confidence}) - ${result.reason}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // DB ログ保存は常にローカルで実行
  if (options?.db && options.date && options.audioFilePath) {
    try {
      options.db
        .insert(schema.evaluatorLogs)
        .values({
          date: options.date,
          audioFilePath: options.audioFilePath,
          transcriptionText: text,
          judgment: result.judgment,
          confidence: result.confidence,
          reason: result.reason,
          suggestedPattern: result.suggestedPattern,
          patternApplied: false,
        })
        .run();
    } catch (err) {
      consola.warn("[evaluator] Failed to save log:", err);
    }
  }

  return result;
}

/**
 * Claude Code CLI を使って HALLUCINATION_PATTERNS に新しい正規表現を追加する。
 * NOTE: applyNewPattern はローカルの claude CLI を直接使用する(コード編集のため)。
 */
export async function applyNewPattern(
  pattern: string,
  reason: string,
  projectRoot: string,
  options?: { db?: AdasDatabase; audioFilePath?: string },
): Promise<void> {
  // 追加前に正規表現の妥当性を検証
  try {
    new RegExp(pattern);
  } catch {
    consola.warn(`Invalid regex pattern, skipping: ${pattern}`);
    return;
  }

  // applyNewPattern はローカルの claude CLI が必要(コード編集操作のため)
  const { runClaude } = await import("@repo/core");

  const prompt = `You are editing a TypeScript project to add a new Whisper hallucination detection pattern.

Project root: ${projectRoot}

Tasks:
1. Read the file "apps/cli/src/commands/transcribe.ts"
2. Find the HALLUCINATION_PATTERNS array
3. Check if a pattern matching "${pattern}" already exists (check for semantic duplicates too)
4. If NOT duplicate, add the following regex to the array:
   /^(${pattern}[\\s.]*)+$/
5. Read "CLAUDE.md" in the project root - no changes needed there unless the pattern category is entirely new

Reason for adding: ${reason}

Important:
- Only add the pattern if it's not already covered by existing patterns
- Maintain the existing code style (indentation, trailing commas, etc.)
- Do not modify anything else in the file`;

  consola.info(`[evaluator] Applying new pattern: ${pattern}`);

  const result = await runClaude(prompt, {
    model: "haiku",
    allowedTools: "Read,Edit",
    dangerouslySkipPermissions: true,
    cwd: projectRoot,
  });

  consola.info(`[evaluator] Pattern apply result: ${result}`);

  // patternApplied を更新
  if (options?.db && options.audioFilePath) {
    try {
      options.db
        .update(schema.evaluatorLogs)
        .set({ patternApplied: true })
        .where(eq(schema.evaluatorLogs.audioFilePath, options.audioFilePath))
        .run();
    } catch (err) {
      consola.warn("[evaluator] Failed to update patternApplied:", err);
    }
  }
}
