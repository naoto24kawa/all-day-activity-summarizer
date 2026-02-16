import { getPromptFilePath } from "@repo/core";
import type { ExtractedTerm, RpcInterpretResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { getLLMProviderForProcess, getProviderInfo } from "../utils/llm-config.js";
import { withProcessingLog } from "../utils/log-processing.js";

const INTERPRET_MODEL = "haiku";

interface InterpretRequestBody {
  text: string;
  speaker?: string;
  context?: string;
  feedbackExamples?: string;
  /** 既存の vocabulary 用語リスト (重複除外用) */
  existingTerms?: string[];
}

interface InterpretJsonResponse {
  interpretedText: string;
  extractedTerms?: ExtractedTerm[];
}

export function createInterpretRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<InterpretRequestBody>();

      if (!body.text) {
        return c.json({ error: "text is required" }, 400);
      }

      const inputSize = body.text.length;
      const result = await withProcessingLog(
        "interpret",
        INTERPRET_MODEL,
        () =>
          interpretWithLLM(
            body.text,
            body.speaker,
            body.context,
            body.feedbackExamples,
            body.existingTerms,
          ),
        (res) => ({
          inputSize,
          outputSize: res.interpretedText.length,
          metadata: { termsExtracted: res.extractedTerms?.length ?? 0 },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/interpret] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function interpretWithLLM(
  text: string,
  speaker?: string,
  context?: string,
  feedbackExamples?: string,
  existingTerms?: string[],
): Promise<RpcInterpretResponse> {
  const speakerInfo = speaker ? `\n話者: ${speaker}` : "";
  const contextInfo = context ? `\n前後の文脈:\n${context}` : "";
  const feedbackSection = feedbackExamples ?? "";
  const existingTermsSection =
    existingTerms && existingTerms.length > 0
      ? `\n\n既に登録済みの用語 (これらは extractedTerms に含めないでください):\n${existingTerms.join(", ")}`
      : "";

  const prompt = `音声認識エンジンが出力した生テキストを、読みやすく自然な日本語に整え、専門用語や固有名詞を抽出してください。

## タスク1: テキスト整形

ルール:
- 音声認識特有の誤変換を修正する(同音異義語、カタカナ/漢字の誤変換など)
- フィラーを除去する(えーと、あのー、まあ、なんか、えー、うーん、その、ほら 等)
- 句読点(、。)を適切に挿入する
- 口語的な繰り返し・言い淀み・言い直しを整理する
- 元の発言の意味や意図を変えないこと
- 情報を追加・削除しないこと

## タスク2: 用語抽出

テキスト内から以下のような用語を抽出してください:
- 技術用語 (プログラミング言語、フレームワーク、ツール名など)
- プロジェクト固有の用語 (製品名、機能名、コードネームなど)
- 人名 (固有名詞)
- 会社名・組織名
- 音声認識で誤変換されやすい専門用語

抽出しないもの:
- 一般的な日本語の単語
- 既に登録済みの用語 (下記参照)
${existingTermsSection}

## 出力形式

以下のJSON形式で出力してください (コードブロックなし):

{
  "interpretedText": "整形されたテキスト",
  "extractedTerms": [
    {
      "term": "用語",
      "reading": "よみがな (任意)",
      "category": "カテゴリ (technology/project/person/company/other)",
      "confidence": 0.8,
      "reason": "抽出理由 (任意)"
    }
  ]
}

抽出する用語がない場合は extractedTerms は空配列 [] としてください。
${speakerInfo}${contextInfo}${feedbackSection}

文字起こしテキスト:
${text}`;

  // LLM Provider を取得 (設定で claude/gemini/lmstudio を切り替え)
  const provider = getLLMProviderForProcess("interpret", INTERPRET_MODEL);
  const providerInfo = getProviderInfo("interpret");

  const modelInfo = providerInfo.model ? `${providerInfo.model}` : INTERPRET_MODEL;
  consola.info(
    `[worker/interpret] Interpreting (${text.length} chars, provider: ${providerInfo.provider}, model: ${modelInfo})...`,
  );

  const result = await provider.generate(prompt, {
    model: INTERPRET_MODEL,
    appendSystemPromptFile: getPromptFilePath("interpret"),
    disableTools: true,
    temperature: 0.3, // 安定した出力のため低めに
  });

  if (!result) {
    throw new Error("No response from interpreter");
  }

  // JSON パース (コードブロックがある場合は除去、または {} を抽出)
  try {
    let jsonStr = result.trim();

    // コードブロックがある場合は除去
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // コードブロックがない場合は {} を抽出
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr) as InterpretJsonResponse;

    consola.info(
      `[worker/interpret] Done (${parsed.interpretedText.length} chars, ${parsed.extractedTerms?.length ?? 0} terms)`,
    );

    return {
      interpretedText: parsed.interpretedText,
      extractedTerms: parsed.extractedTerms ?? [],
    };
  } catch (parseErr) {
    // JSON パース失敗時は従来の形式として処理
    consola.warn("[worker/interpret] Failed to parse JSON, falling back to plain text:", parseErr);
    consola.info(`[worker/interpret] Done (${result.length} chars, fallback mode)`);

    return { interpretedText: result.trim() };
  }
}
