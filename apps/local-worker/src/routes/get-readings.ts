/**
 * 読み仮名取得エンドポイント
 *
 * kuromoji.js を使用して用語から読み仮名を取得
 */

import consola from "consola";
import { Hono } from "hono";
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import kuromoji from "kuromoji";

const DICT_PATH = "node_modules/kuromoji/dict";

interface GetReadingsRequestBody {
  terms: string[];
}

interface ReadingResult {
  term: string;
  reading: string | null;
}

interface GetReadingsResponse {
  results: ReadingResult[];
}

// トークナイザーのシングルトン (tokenize.ts と共有)
let tokenizerInstance: Tokenizer<IpadicFeatures> | null = null;
let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | null = null;

async function getTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  if (tokenizerInstance) {
    return tokenizerInstance;
  }

  if (tokenizerPromise) {
    return tokenizerPromise;
  }

  tokenizerPromise = new Promise((resolve, reject) => {
    consola.info("[get-readings] Loading kuromoji dictionary...");
    kuromoji.builder({ dicPath: DICT_PATH }).build((err, tokenizer) => {
      if (err) {
        consola.error("[get-readings] Failed to load kuromoji:", err);
        reject(err);
        return;
      }
      consola.success("[get-readings] Kuromoji dictionary loaded");
      tokenizerInstance = tokenizer;
      resolve(tokenizer);
    });
  });

  return tokenizerPromise;
}

/**
 * 用語から読みを取得
 * - 単一トークンの場合: そのトークンの reading を返す
 * - 複数トークンの場合: 全トークンの reading を結合して返す
 */
function getReadingForTerm(tokenizer: Tokenizer<IpadicFeatures>, term: string): string | null {
  const tokens = tokenizer.tokenize(term);

  if (tokens.length === 0) {
    return null;
  }

  // 全トークンの reading を結合
  const readings: string[] = [];
  for (const token of tokens) {
    if (token.reading && token.reading !== "*") {
      readings.push(token.reading);
    } else {
      // reading がないトークンがある場合は全体として null を返す
      return null;
    }
  }

  return readings.join("");
}

export function createGetReadingsRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<GetReadingsRequestBody>();

      if (!body.terms || !Array.isArray(body.terms)) {
        return c.json({ error: "terms array is required" }, 400);
      }

      const tokenizer = await getTokenizer();

      const results: ReadingResult[] = body.terms.map((term) => ({
        term,
        reading: getReadingForTerm(tokenizer, term),
      }));

      const foundCount = results.filter((r) => r.reading !== null).length;
      consola.info(
        `[get-readings] Processed ${body.terms.length} terms, found readings for ${foundCount}`,
      );

      const response: GetReadingsResponse = { results };
      return c.json(response);
    } catch (err) {
      consola.error("[local-worker/get-readings] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}
