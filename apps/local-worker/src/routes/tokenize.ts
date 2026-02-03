/**
 * 形態素解析エンドポイント
 *
 * kuromoji.js を使用してテキストから名詞・固有名詞を抽出
 */

import { consola } from "@repo/core";
import { Hono } from "hono";
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import kuromoji from "kuromoji";

// kuromoji 辞書パスを特定
const DICT_PATH = "node_modules/kuromoji/dict";

interface TokenizeRequestBody {
  text: string;
  existingTerms?: string[];
}

interface TokenCandidate {
  term: string;
  reading: string | null;
  pos: string;
  posDetail: string;
  frequency: number;
}

interface TokenizeResponse {
  candidates: TokenCandidate[];
  tokenCount: number;
}

// トークナイザーのシングルトン
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
    consola.info("[tokenize] Loading kuromoji dictionary...");
    kuromoji.builder({ dicPath: DICT_PATH }).build((err, tokenizer) => {
      if (err) {
        consola.error("[tokenize] Failed to load kuromoji:", err);
        reject(err);
        return;
      }
      consola.success("[tokenize] Kuromoji dictionary loaded");
      tokenizerInstance = tokenizer;
      resolve(tokenizer);
    });
  });

  return tokenizerPromise;
}

// 抽出対象の品詞
const TARGET_POS = ["名詞"];
const TARGET_POS_DETAILS = [
  "一般",
  "固有名詞",
  "サ変接続",
  "形容動詞語幹",
  "副詞可能",
  "ナイ形容詞語幹",
];

// 除外パターン
const EXCLUDE_PATTERNS = [
  /^[ぁ-ん]{1,2}$/, // 短いひらがな
  /^[a-zA-Z]{1,2}$/, // 短い英字
  /^[0-9]+$/, // 数字のみ
  /^[、。！？・…]+$/, // 記号のみ
];

// 除外する一般的な単語
const COMMON_WORDS = new Set([
  "こと",
  "もの",
  "ため",
  "よう",
  "ところ",
  "これ",
  "それ",
  "あれ",
  "どれ",
  "ここ",
  "そこ",
  "あそこ",
  "何",
  "誰",
  "どこ",
  "いつ",
  "なぜ",
  "どう",
  "の",
  "に",
  "を",
  "が",
  "は",
  "と",
  "で",
  "から",
  "まで",
  "より",
  "へ",
  "私",
  "僕",
  "俺",
  "自分",
  "今日",
  "明日",
  "昨日",
  "今",
  "後",
  "前",
  "次",
  "最初",
  "最後",
  "方",
  "人",
  "時",
  "場合",
  "際",
  "上",
  "下",
  "中",
  "外",
  "内",
  "間",
  "以上",
  "以下",
  "以外",
  "以内",
  "等",
  "的",
  "性",
  "化",
  "感",
  "力",
  "度",
  "率",
  "量",
  "数",
  "点",
  "面",
  "側",
  "部",
  "所",
  "分",
  "回",
  "件",
  "本",
  "個",
  "つ",
  "目",
  "者",
  "用",
  "系",
]);

function shouldInclude(token: IpadicFeatures): boolean {
  // 品詞チェック
  if (!TARGET_POS.includes(token.pos)) {
    return false;
  }

  // 品詞詳細チェック (代名詞、非自立、接尾は除外)
  if (["代名詞", "非自立", "接尾", "数", "接続詞的"].includes(token.pos_detail_1)) {
    return false;
  }

  // 対象の品詞詳細かチェック
  if (!TARGET_POS_DETAILS.includes(token.pos_detail_1)) {
    return false;
  }

  const surface = token.surface_form;

  // 除外パターンチェック
  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(surface))) {
    return false;
  }

  // 一般的な単語チェック
  if (COMMON_WORDS.has(surface)) {
    return false;
  }

  // 1文字の漢字は除外 (意味のある固有名詞は通常2文字以上)
  if (/^[\u4e00-\u9faf]$/.test(surface)) {
    return false;
  }

  return true;
}

export function createTokenizeRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<TokenizeRequestBody>();

      if (!body.text) {
        return c.json({ error: "text is required" }, 400);
      }

      const existingTermsSet = new Set((body.existingTerms ?? []).map((t) => t.toLowerCase()));

      const tokenizer = await getTokenizer();
      const tokens = tokenizer.tokenize(body.text);

      consola.info(`[tokenize] Tokenized ${tokens.length} tokens from ${body.text.length} chars`);

      // 候補を集計
      const candidateMap = new Map<string, TokenCandidate>();

      for (const token of tokens) {
        if (!shouldInclude(token)) {
          continue;
        }

        const term = token.surface_form;
        const termLower = term.toLowerCase();

        // 既存の用語は除外
        if (existingTermsSet.has(termLower)) {
          continue;
        }

        const existing = candidateMap.get(termLower);
        if (existing) {
          existing.frequency++;
        } else {
          candidateMap.set(termLower, {
            term,
            reading: token.reading && token.reading !== "*" ? token.reading : null,
            pos: token.pos,
            posDetail: token.pos_detail_1,
            frequency: 1,
          });
        }
      }

      // 頻度順にソートして返す
      const candidates = Array.from(candidateMap.values())
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 100); // 最大 100 件

      consola.info(`[tokenize] Found ${candidates.length} candidates`);

      const response: TokenizeResponse = {
        candidates,
        tokenCount: tokens.length,
      };

      return c.json(response);
    } catch (err) {
      consola.error("[local-worker/tokenize] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}
