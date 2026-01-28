import { readFileSync } from "node:fs";
import { getPromptFilePath } from "@repo/core";

function readPrompt(name: string): string {
  return readFileSync(getPromptFilePath(name), "utf-8");
}

export function buildHourlySummaryPrompt(transcription: string): string {
  const template = readPrompt("summarize-hourly");
  return `${template}\n\n---\n文字起こしデータ:\n${transcription}`;
}

export function buildDailySummaryPrompt(summaries: string): string {
  const template = readPrompt("summarize-daily");
  return `${template}\n\n---\n時間帯別要約:\n${summaries}`;
}
