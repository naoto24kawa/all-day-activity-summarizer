/**
 * 読み仮名生成エンドポイント
 *
 * LM Studio / Claude で用語の読み仮名を生成
 */

import consola from "consola";
import { Hono } from "hono";
import { getLLMProviderForProcess, getProviderInfo } from "../utils/llm-config.js";
import { withProcessingLog } from "../utils/log-processing.js";

interface GenerateReadingsRequestBody {
  /** 読みを生成する用語リスト */
  terms: string[];
}

interface ReadingResult {
  term: string;
  reading: string | null;
}

interface GenerateReadingsResponse {
  results: ReadingResult[];
}

export function createGenerateReadingsRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<GenerateReadingsRequestBody>();

      if (!body.terms || !Array.isArray(body.terms) || body.terms.length === 0) {
        return c.json({ error: "terms array is required" }, 400);
      }

      const providerInfo = getProviderInfo("generateReadings");
      consola.info(
        `[ai-worker/generate-readings] Generating readings for ${body.terms.length} terms using ${providerInfo.provider}`,
      );

      const result = await withProcessingLog(
        "generate-readings",
        providerInfo.provider,
        () => generateReadingsWithLLM(body.terms),
        (res) => ({
          inputSize: body.terms.length,
          outputSize: res.results.filter((r) => r.reading !== null).length,
        }),
      );

      return c.json(result);
    } catch (err) {
      consola.error("[ai-worker/generate-readings] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function generateReadingsWithLLM(terms: string[]): Promise<GenerateReadingsResponse> {
  const termList = terms.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `以下の用語の読み仮名(ひらがな)を生成してください。

## 用語リスト

${termList}

## ルール

1. 読み仮名は全てひらがなで出力
2. 英語やカタカナ語はカタカナ読みをひらがなに変換 (例: TypeScript → たいぷすくりぷと)
3. 略語は一般的な読み方を使用 (例: API → えーぴーあい, DB → でーびー)
4. 読みが不明な場合は null を設定

## 出力形式

**重要**: 説明文や前置きは一切不要です。JSON のみを出力してください。

{
  "results": [
    {"term": "用語1", "reading": "よみがな"},
    {"term": "用語2", "reading": null}
  ]
}`;

  const provider = getLLMProviderForProcess("generateReadings");
  const result = await provider.generate(prompt);

  if (!result) {
    return { results: terms.map((term) => ({ term, reading: null })) };
  }

  try {
    // コードブロックがある場合は除去
    let jsonStr = result.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();

    // results を含む JSON 部分を抽出
    const extractedJson = extractJsonWithResults(jsonStr);
    if (!extractedJson) {
      consola.warn(
        "[ai-worker/generate-readings] No valid JSON found in response:",
        result.slice(0, 200),
      );
      return { results: terms.map((term) => ({ term, reading: null })) };
    }
    jsonStr = extractedJson;

    const parsed = JSON.parse(jsonStr) as GenerateReadingsResponse;
    const foundCount = parsed.results?.filter((r) => r.reading !== null).length ?? 0;

    consola.info(
      `[ai-worker/generate-readings] Done (${foundCount}/${terms.length} readings generated)`,
    );

    return {
      results: parsed.results ?? terms.map((term) => ({ term, reading: null })),
    };
  } catch (parseErr) {
    consola.warn(
      "[ai-worker/generate-readings] Failed to parse JSON:",
      parseErr,
      "\nResponse preview:",
      result.slice(0, 300),
    );
    return { results: terms.map((term) => ({ term, reading: null })) };
  }
}

/**
 * results キーを含む有効な JSON オブジェクトを抽出
 */
function extractJsonWithResults(text: string): string | null {
  const resultsIndex = text.indexOf('"results"');
  if (resultsIndex === -1) {
    return null;
  }

  // その前の最初の { を探す
  let startIndex = -1;
  for (let i = resultsIndex - 1; i >= 0; i--) {
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

  try {
    JSON.parse(jsonCandidate);
    return jsonCandidate;
  } catch {
    return null;
  }
}
