import { runClaude } from "@repo/core";
import type { LearningCategory } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";

const EXTRACT_MODEL = "haiku";

interface ExtractLearningsRequestBody {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  projectName?: string;
}

export interface ExtractedLearning {
  content: string;
  category: LearningCategory;
  tags: string[];
  confidence: number;
}

interface ExtractLearningsResponse {
  learnings: ExtractedLearning[];
}

export function createExtractLearningsRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<ExtractLearningsRequestBody>();

      if (!body.messages || body.messages.length === 0) {
        return c.json({ error: "messages is required" }, 400);
      }

      const result = await extractLearningsWithClaude(body.messages, body.projectName);
      return c.json(result);
    } catch (err) {
      consola.error("[worker/extract-learnings] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function extractLearningsWithClaude(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  projectName?: string,
): Promise<ExtractLearningsResponse> {
  // メッセージを会話形式に整形
  const conversation = messages
    .map((m) => `[${m.role === "user" ? "User" : "Assistant"}]: ${m.content}`)
    .join("\n\n");

  const projectInfo = projectName ? `プロジェクト: ${projectName}\n\n` : "";

  const prompt = `以下の Claude Code セッションの会話から、ユーザーが学んだと思われる技術的な知見を抽出してください。

${projectInfo}会話:
${conversation}

ルール:
- ユーザーにとって新しい発見や、役立つ技術的知見のみを抽出する
- 一般的すぎる内容や、単なる操作説明は除外する
- 各学びは簡潔に1-2文でまとめる
- 学びがない場合は空の配列を返す
- 最大5つまで抽出する

JSON形式で出力:
{
  "learnings": [
    {
      "content": "学びの内容",
      "category": "typescript" | "react" | "architecture" | "testing" | "devops" | "database" | "api" | "security" | "performance" | "other",
      "tags": ["関連タグ1", "関連タグ2"],
      "confidence": 0.0-1.0
    }
  ]
}`;

  consola.info(`[worker/extract-learnings] Extracting from ${messages.length} messages...`);

  const result = await runClaude(prompt, {
    model: EXTRACT_MODEL,
    disableTools: true,
  });

  if (!result) {
    return { learnings: [] };
  }

  try {
    // JSON部分を抽出
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      consola.warn("[worker/extract-learnings] No JSON found in response");
      return { learnings: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractLearningsResponse;
    consola.info(`[worker/extract-learnings] Extracted ${parsed.learnings.length} learnings`);
    return parsed;
  } catch (parseErr) {
    consola.error("[worker/extract-learnings] Failed to parse response:", parseErr);
    return { learnings: [] };
  }
}
