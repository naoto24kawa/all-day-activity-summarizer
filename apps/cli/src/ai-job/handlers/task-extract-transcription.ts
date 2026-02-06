/**
 * Task Extract Transcription Handler
 *
 * 音声セグメントからのタスク抽出ジョブハンドラー
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, desc, eq, gte } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { hasExtractionLog, recordExtractionLog } from "../../utils/extraction-log.js";
import { buildVocabularySection } from "../../utils/vocabulary.js";
import type { JobResult } from "../worker.js";

interface ExtractedTask {
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  confidence?: number;
}

interface ExtractResult {
  tasks: ExtractedTask[];
}

type AggregationType = "time_window" | "speaker";

interface TranscriptionWindow {
  startTime: string;
  endTime: string;
  segments: (typeof schema.transcriptionSegments.$inferSelect)[];
  combinedText: string;
}

/**
 * 音声セグメントからタスク抽出
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleTaskExtractTranscription(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = (params.date as string) ?? getTodayDateString();
  const aggregationType = (params.aggregationType as AggregationType) ?? "time_window";

  // 対象セグメントを取得 (interpretedText がある、または transcription がある)
  const segments = db
    .select()
    .from(schema.transcriptionSegments)
    .where(eq(schema.transcriptionSegments.date, date))
    .orderBy(schema.transcriptionSegments.startTime)
    .all();

  if (segments.length === 0) {
    return {
      success: true,
      resultSummary: "対象の音声セグメントがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  // 抽出済みチェック用識別子を構築
  const extractionId = `transcription-${date}`;
  if (hasExtractionLog(db, "task", "transcription", extractionId)) {
    return {
      success: true,
      resultSummary: "本日の音声セグメントは処理済みです",
      data: { extracted: 0, tasks: [] },
    };
  }

  // セグメントを集約
  const windows =
    aggregationType === "speaker"
      ? aggregateBySpeaker(segments)
      : aggregateByTimeWindow(segments, 30); // 30分単位

  if (windows.length === 0) {
    return {
      success: true,
      resultSummary: "抽出対象のテキストがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  const vocabularySection = buildVocabularySection(db);
  const processedTasksSection = buildProcessedTasksSection(db);
  const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

  const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];

  for (const window of windows) {
    const userPrompt = buildTranscriptionPrompt(window, vocabularySection, processedTasksSection);

    try {
      const response = await runClaude(userPrompt, {
        model: "haiku",
        systemPrompt,
        disableTools: true,
      });

      const parsed = parseExtractResult(response);

      if (parsed.tasks.length > 0) {
        for (const extractedTask of parsed.tasks) {
          // 最初のセグメントを代表として紐付け
          const representativeSegment = window.segments[0];
          if (!representativeSegment) continue;

          const task = db
            .insert(schema.tasks)
            .values({
              date,
              transcriptionSegmentId: representativeSegment.id,
              sourceType: "transcription",
              title: extractedTask.title,
              description: extractedTask.description ?? null,
              priority: extractedTask.priority ?? null,
              confidence: extractedTask.confidence ?? null,
            })
            .returning()
            .get();

          createdTasks.push(task);
        }
      }
    } catch (error) {
      console.error("Failed to extract tasks from transcription window:", error);
    }
  }

  // 処理済みを記録
  recordExtractionLog(db, "task", "transcription", extractionId, createdTasks.length);

  return {
    success: true,
    resultSummary:
      createdTasks.length > 0
        ? `音声から${createdTasks.length}件のタスクを抽出しました`
        : "音声からタスクは抽出されませんでした",
    data: { extracted: createdTasks.length, tasks: createdTasks },
  };
}

/**
 * 時間ウィンドウで集約 (例: 30分単位)
 */
function aggregateByTimeWindow(
  segments: (typeof schema.transcriptionSegments.$inferSelect)[],
  windowMinutes: number,
): TranscriptionWindow[] {
  if (segments.length === 0) return [];

  const windows: TranscriptionWindow[] = [];
  let currentWindow: TranscriptionWindow | null = null;

  for (const segment of segments) {
    const segmentStart = new Date(segment.startTime);

    if (
      !currentWindow ||
      segmentStart.getTime() - new Date(currentWindow.endTime).getTime() > windowMinutes * 60 * 1000
    ) {
      // 新しいウィンドウを開始
      if (currentWindow && currentWindow.combinedText.trim()) {
        windows.push(currentWindow);
      }
      currentWindow = {
        startTime: segment.startTime,
        endTime: segment.endTime,
        segments: [segment],
        combinedText: getSegmentText(segment),
      };
    } else {
      // 既存ウィンドウに追加
      currentWindow.endTime = segment.endTime;
      currentWindow.segments.push(segment);
      currentWindow.combinedText += "\n" + getSegmentText(segment);
    }
  }

  // 最後のウィンドウを追加
  if (currentWindow && currentWindow.combinedText.trim()) {
    windows.push(currentWindow);
  }

  return windows;
}

/**
 * 話者で集約
 */
function aggregateBySpeaker(
  segments: (typeof schema.transcriptionSegments.$inferSelect)[],
): TranscriptionWindow[] {
  const speakerMap = new Map<string, (typeof schema.transcriptionSegments.$inferSelect)[]>();

  for (const segment of segments) {
    const speaker = segment.speaker ?? "unknown";
    const existing = speakerMap.get(speaker) ?? [];
    existing.push(segment);
    speakerMap.set(speaker, existing);
  }

  const windows: TranscriptionWindow[] = [];

  for (const [, speakerSegments] of speakerMap) {
    if (speakerSegments.length === 0) continue;

    const first = speakerSegments[0];
    const last = speakerSegments[speakerSegments.length - 1];
    if (!first || !last) continue;

    const combinedText = speakerSegments.map(getSegmentText).join("\n");
    if (!combinedText.trim()) continue;

    windows.push({
      startTime: first.startTime,
      endTime: last.endTime,
      segments: speakerSegments,
      combinedText,
    });
  }

  return windows;
}

function getSegmentText(segment: typeof schema.transcriptionSegments.$inferSelect): string {
  return segment.interpretedText ?? segment.transcription;
}

function buildTranscriptionPrompt(
  window: TranscriptionWindow,
  vocabularySection: string,
  processedTasksSection: string,
): string {
  const timeRange = `${formatTime(window.startTime)} - ${formatTime(window.endTime)}`;

  return `以下の音声書き起こしからタスクを抽出してください。
「TODO」「やること」「あとで」「対応が必要」などの言及があればタスク化してください。
単なる会話や独り言はタスクとして抽出しないでください。
${vocabularySection}${processedTasksSection}

## 音声 (${timeRange})
${window.combinedText}`;
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function buildProcessedTasksSection(db: AdasDatabase): string {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0] ?? "";

  const completedTasks = db
    .select({
      title: schema.tasks.title,
      description: schema.tasks.description,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "completed"), gte(schema.tasks.date, thirtyDaysAgoStr)))
    .orderBy(desc(schema.tasks.completedAt))
    .limit(10)
    .all();

  if (completedTasks.length === 0) {
    return "";
  }

  let section = "\n\n## 過去の完了済みタスク (重複チェック用)\n";
  for (const task of completedTasks) {
    section += `- ${task.title}\n`;
  }

  return section;
}

function parseExtractResult(response: string): ExtractResult {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1]?.trim() : response.trim();

    const parsed = JSON.parse(jsonStr ?? "{}");
    return parsed as ExtractResult;
  } catch {
    return { tasks: [] };
  }
}

function getTodayDateString(): string {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jst = new Date(now.getTime() + jstOffset);
  return jst.toISOString().split("T")[0] ?? "";
}
