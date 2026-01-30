import { readFileSync } from "node:fs";
import { getPromptFilePath } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { injectFeedbackExamples } from "../feedback-injector.js";
import { buildVocabularySection } from "../utils/vocabulary.js";

function readPrompt(name: string): string {
  return readFileSync(getPromptFilePath(name), "utf-8");
}

/**
 * 時間帯別サマリー用プロンプトを構築
 * DB が渡された場合、フィードバックを few-shot examples として挿入
 * また、vocabulary から用語セクションを追加
 */
export async function buildHourlySummaryPrompt(
  transcription: string,
  db?: AdasDatabase,
): Promise<string> {
  let template = readPrompt("summarize-hourly");

  if (db) {
    template = await injectFeedbackExamples(template, "summarize-hourly", db);
    // vocabulary セクションを追加
    const vocabularySection = buildVocabularySection(db);
    if (vocabularySection) {
      template = template + vocabularySection;
    }
  }

  return `${template}\n\n---\n文字起こしデータ:\n${transcription}`;
}

/**
 * 日次サマリー用プロンプトを構築
 * DB が渡された場合、フィードバックを few-shot examples として挿入
 * また、vocabulary から用語セクションを追加
 */
export async function buildDailySummaryPrompt(
  summaries: string,
  db?: AdasDatabase,
): Promise<string> {
  let template = readPrompt("summarize-daily");

  if (db) {
    template = await injectFeedbackExamples(template, "summarize-daily", db);
    // vocabulary セクションを追加
    const vocabularySection = buildVocabularySection(db);
    if (vocabularySection) {
      template = template + vocabularySection;
    }
  }

  return `${template}\n\n---\n時間帯別要約:\n${summaries}`;
}
