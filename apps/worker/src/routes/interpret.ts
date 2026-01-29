import { getPromptFilePath, runClaude } from "@repo/core";
import type { RpcInterpretResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";

const INTERPRET_MODEL = "sonnet";

interface InterpretRequestBody {
  text: string;
  speaker?: string;
  context?: string;
  feedbackExamples?: string;
}

export function createInterpretRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<InterpretRequestBody>();

      if (!body.text) {
        return c.json({ error: "text is required" }, 400);
      }

      const result = await interpretWithClaude(
        body.text,
        body.speaker,
        body.context,
        body.feedbackExamples,
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/interpret] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function interpretWithClaude(
  text: string,
  speaker?: string,
  context?: string,
  feedbackExamples?: string,
): Promise<RpcInterpretResponse> {
  const speakerInfo = speaker ? `\n話者: ${speaker}` : "";
  const contextInfo = context ? `\n前後の文脈:\n${context}` : "";
  const feedbackSection = feedbackExamples ?? "";

  const prompt = `音声認識エンジンが出力した生テキストを、読みやすく自然な日本語に整えてください。

ルール:
- 音声認識特有の誤変換を修正する(同音異義語、カタカナ/漢字の誤変換など)
- フィラーを除去する(えーと、あのー、まあ、なんか、えー、うーん、その、ほら 等)
- 句読点(、。)を適切に挿入する
- 口語的な繰り返し・言い淀み・言い直しを整理する
- 元の発言の意味や意図を変えないこと
- 情報を追加・削除しないこと
- 整えたテキストのみを出力すること(説明や引用符は不要)
${speakerInfo}${contextInfo}${feedbackSection}

文字起こしテキスト:
${text}`;

  consola.info(`[worker/interpret] Interpreting (${text.length} chars)...`);

  const result = await runClaude(prompt, {
    model: INTERPRET_MODEL,
    appendSystemPromptFile: getPromptFilePath("interpret"),
    disableTools: true,
  });

  if (!result) {
    throw new Error("No response from interpreter");
  }

  consola.info(`[worker/interpret] Done (${result.length} chars)`);

  return { interpretedText: result.trim() };
}
