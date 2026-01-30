/**
 * Vocabulary utilities for prompt enhancement
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";

/**
 * DB から vocabulary 用語リストを取得
 */
export function getVocabularyTerms(db: AdasDatabase): string[] {
  const terms = db.select().from(schema.vocabulary).all();
  return terms.map((v) => v.term);
}

/**
 * vocabulary セクションをプロンプトに追加するための文字列を生成
 * 用語がない場合は空文字を返す
 */
export function buildVocabularySection(db: AdasDatabase): string {
  const terms = getVocabularyTerms(db);

  if (terms.length === 0) {
    return "";
  }

  return `

## 用語辞書
以下の用語は正確に使用してください (表記揺れを避ける):
${terms.join("、")}
`;
}
