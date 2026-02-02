/**
 * Explain Learning Route
 *
 * Takes an existing learning content and generates a detailed explanation using AI.
 */

import { runClaude } from "@repo/core";
import type { LearningCategory } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { withProcessingLog } from "../utils/log-processing.js";

const EXPLAIN_MODEL = "sonnet";

interface UserProfileContext {
  experienceYears?: number;
  specialties?: string[];
  knownTechnologies?: string[];
  learningGoals?: string[];
}

interface ExplainLearningRequestBody {
  /** 学びの内容 */
  content: string;
  /** カテゴリ (例: typescript, react, architecture) */
  category?: LearningCategory | null;
  /** タグ (JSON 配列文字列または配列) */
  tags?: string | string[] | null;
  /** プロジェクト名 */
  projectName?: string;
  /** 追加コンテキスト */
  contextInfo?: string;
  /** ユーザープロフィール情報 */
  userProfile?: UserProfileContext;
  /** 用語辞書 (正確な用語使用のため) */
  vocabulary?: string[];
}

interface ExplainLearningResponse {
  explanation: string;
  keyPoints: string[];
  relatedTopics: string[];
  practicalExamples?: string[];
}

export function createExplainLearningRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<ExplainLearningRequestBody>();

      if (!body.content) {
        return c.json({ error: "content is required" }, 400);
      }

      const result = await withProcessingLog(
        "explain-learning",
        EXPLAIN_MODEL,
        () => explainLearningWithClaude(body),
        (res) => ({
          inputSize: body.content.length,
          outputSize: res.explanation.length,
          metadata: { category: body.category || "unknown" },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/explain-learning] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

function buildPrompt(body: ExplainLearningRequestBody): string {
  const projectInfo = body.projectName ? `プロジェクト: ${body.projectName}\n\n` : "";
  const contextSection = body.contextInfo ? `コンテキスト: ${body.contextInfo}\n\n` : "";

  // タグの処理
  let tagsStr = "";
  if (body.tags) {
    const tagArray =
      typeof body.tags === "string" ? (JSON.parse(body.tags) as string[]) : body.tags;
    if (tagArray.length > 0) {
      tagsStr = `関連タグ: ${tagArray.join(", ")}\n`;
    }
  }

  // 用語辞書セクション
  const vocabularySection =
    body.vocabulary && body.vocabulary.length > 0
      ? `\n\n## 用語辞書\n以下の用語は正確に使用してください (表記揺れを避ける):\n${body.vocabulary.join("、")}\n`
      : "";

  // ユーザープロフィール情報セクション
  let profileSection = "";
  if (body.userProfile) {
    const parts: string[] = [];
    if (body.userProfile.experienceYears !== undefined) {
      parts.push(`経験年数: ${body.userProfile.experienceYears}年`);
    }
    if (body.userProfile.specialties && body.userProfile.specialties.length > 0) {
      parts.push(`専門分野: ${body.userProfile.specialties.join(", ")}`);
    }
    if (body.userProfile.knownTechnologies && body.userProfile.knownTechnologies.length > 0) {
      parts.push(`既知技術: ${body.userProfile.knownTechnologies.join(", ")}`);
    }
    if (body.userProfile.learningGoals && body.userProfile.learningGoals.length > 0) {
      parts.push(`学習目標: ${body.userProfile.learningGoals.join(", ")}`);
    }
    if (parts.length > 0) {
      profileSection = `ユーザープロフィール:
${parts.map((p) => `- ${p}`).join("\n")}

注意: ユーザーの経験レベルに合わせた説明を心がけてください。学習目標に関連する内容は特に詳しく説明してください。

`;
    }
  }

  const categoryInfo = body.category ? `カテゴリ: ${body.category}\n` : "";

  return `以下の技術的な学びについて、より詳しく説明してください。
${vocabularySection}
${profileSection}${projectInfo}${contextSection}${categoryInfo}${tagsStr}
## 学びの内容
${body.content}

## 指示
上記の学びについて、以下の観点で詳細な説明を生成してください:

1. **explanation**: 学びの内容を詳しく解説してください。背景、理由、仕組みなどを含めて、初めて知る人にも理解できるように説明してください。

2. **keyPoints**: この学びから得られる重要なポイントを3〜5個、箇条書きでまとめてください。

3. **relatedTopics**: この学びに関連する技術トピックやキーワードを3〜5個挙げてください。

4. **practicalExamples** (オプション): 可能であれば、この学びを実践で活用する具体例やコードスニペットを1〜2個提示してください。

## 出力形式
JSON形式で出力してください:
{
  "explanation": "詳細な説明文 (Markdown形式可)",
  "keyPoints": ["ポイント1", "ポイント2", ...],
  "relatedTopics": ["トピック1", "トピック2", ...],
  "practicalExamples": ["例1", "例2", ...] // オプション
}`;
}

async function explainLearningWithClaude(
  body: ExplainLearningRequestBody,
): Promise<ExplainLearningResponse> {
  const prompt = buildPrompt(body);

  consola.info(
    `[worker/explain-learning] Generating explanation for learning (category: ${body.category || "unknown"})...`,
  );

  const result = await runClaude(prompt, {
    model: EXPLAIN_MODEL,
    disableTools: true,
  });

  if (!result) {
    return {
      explanation: "説明を生成できませんでした。",
      keyPoints: [],
      relatedTopics: [],
    };
  }

  try {
    // JSON部分を抽出
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      consola.warn("[worker/explain-learning] No JSON found in response");
      return {
        explanation: result,
        keyPoints: [],
        relatedTopics: [],
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExplainLearningResponse;
    consola.info("[worker/explain-learning] Generated explanation successfully");
    return {
      explanation: parsed.explanation || "",
      keyPoints: parsed.keyPoints || [],
      relatedTopics: parsed.relatedTopics || [],
      practicalExamples: parsed.practicalExamples,
    };
  } catch (parseErr) {
    consola.error("[worker/explain-learning] Failed to parse response:", parseErr);
    return {
      explanation: result,
      keyPoints: [],
      relatedTopics: [],
    };
  }
}
