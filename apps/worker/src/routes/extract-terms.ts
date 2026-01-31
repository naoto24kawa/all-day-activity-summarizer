import { runClaude } from "@repo/core";
import type { ExtractedTerm } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { withProcessingLog } from "../utils/log-processing.js";

const EXTRACT_TERMS_MODEL = "haiku";

interface ExtractTermsRequestBody {
  text: string;
  sourceType: "slack" | "github" | "claude-code" | "memo";
  /** 既存の vocabulary 用語リスト (重複除外用) */
  existingTerms?: string[];
}

interface ExtractTermsResponse {
  extractedTerms: ExtractedTerm[];
}

export function createExtractTermsRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<ExtractTermsRequestBody>();

      if (!body.text) {
        return c.json({ error: "text is required" }, 400);
      }

      if (!body.sourceType) {
        return c.json({ error: "sourceType is required" }, 400);
      }

      const result = await withProcessingLog(
        "extract-terms",
        EXTRACT_TERMS_MODEL,
        () => extractTermsWithClaude(body.text, body.sourceType, body.existingTerms),
        (res) => ({
          inputSize: body.text.length,
          outputSize: res.extractedTerms.length,
          metadata: { sourceType: body.sourceType },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/extract-terms] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function extractTermsWithClaude(
  text: string,
  sourceType: string,
  existingTerms?: string[],
): Promise<ExtractTermsResponse> {
  const existingTermsSection =
    existingTerms && existingTerms.length > 0
      ? `\n\n既に登録済みの用語 (これらは extractedTerms に含めないでください):\n${existingTerms.join(", ")}`
      : "";

  const sourceDescription = getSourceDescription(sourceType);

  const prompt = `以下の${sourceDescription}から、専門用語や固有名詞を抽出してください。

## 抽出対象

- 技術用語 (プログラミング言語、フレームワーク、ツール名、ライブラリ名など)
- プロジェクト固有の用語 (製品名、機能名、コードネーム、モジュール名など)
- 人名 (固有名詞)
- 会社名・組織名
- 略語・アクロニム (API, CI/CD, DDD など)
- ドメイン固有の専門用語

## 抽出しないもの

- 一般的な日本語/英語の単語
- 既に登録済みの用語 (下記参照)
- 冠詞や前置詞などの機能語
- 数字のみのもの
${existingTermsSection}

## 出力形式

**重要**: 説明文や前置きは一切不要です。JSON のみを出力してください。

{
  "extractedTerms": [
    {
      "term": "用語",
      "reading": "よみがな (日本語の場合のみ、任意)",
      "category": "technology/project/person/company/other",
      "confidence": 0.8,
      "reason": "抽出理由 (任意)"
    }
  ]
}

抽出する用語がない場合: {"extractedTerms": []}

## テキスト

${text}`;

  consola.info(`[worker/extract-terms] Extracting from ${sourceType} (${text.length} chars)...`);

  const result = await runClaude(prompt, {
    model: EXTRACT_TERMS_MODEL,
    disableTools: true,
  });

  if (!result) {
    return { extractedTerms: [] };
  }

  // JSON パース
  try {
    // コードブロックがある場合は除去
    let jsonStr = result.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();

    // 説明文が含まれている場合、extractedTerms を含む JSON 部分を抽出
    const extractedJson = extractJsonWithExtractedTerms(jsonStr);
    if (!extractedJson) {
      consola.warn("[worker/extract-terms] No valid JSON found in response:", result.slice(0, 200));
      return { extractedTerms: [] };
    }
    jsonStr = extractedJson;

    const parsed = JSON.parse(jsonStr) as ExtractTermsResponse;

    consola.info(
      `[worker/extract-terms] Done (${parsed.extractedTerms?.length ?? 0} terms extracted)`,
    );

    return {
      extractedTerms: parsed.extractedTerms ?? [],
    };
  } catch (parseErr) {
    consola.warn(
      "[worker/extract-terms] Failed to parse JSON:",
      parseErr,
      "\nResponse preview:",
      result.slice(0, 300),
    );
    return { extractedTerms: [] };
  }
}

function getSourceDescription(sourceType: string): string {
  switch (sourceType) {
    case "slack":
      return "Slack メッセージ";
    case "github":
      return "GitHub Issue/PR/コメント";
    case "claude-code":
      return "Claude Code セッション";
    case "memo":
      return "メモ";
    default:
      return "テキスト";
  }
}

/**
 * extractedTerms キーを含む有効な JSON オブジェクトを抽出
 * ブレースのバランスを見て正しい JSON 境界を特定
 */
function extractJsonWithExtractedTerms(text: string): string | null {
  // "extractedTerms" を含む位置を探す
  const extractedTermsIndex = text.indexOf('"extractedTerms"');
  if (extractedTermsIndex === -1) {
    return null;
  }

  // その前の最初の { を探す
  let startIndex = -1;
  for (let i = extractedTermsIndex - 1; i >= 0; i--) {
    if (text[i] === "{") {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    return null;
  }

  // ブレースのバランスを取りながら終了位置を探す
  let braceCount = 0;
  let endIndex = -1;

  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === "{") {
      braceCount++;
    } else if (text[i] === "}") {
      braceCount--;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (endIndex === -1) {
    return null;
  }

  const jsonCandidate = text.slice(startIndex, endIndex + 1);

  // 有効な JSON かどうか試しにパース
  try {
    JSON.parse(jsonCandidate);
    return jsonCandidate;
  } catch {
    return null;
  }
}
