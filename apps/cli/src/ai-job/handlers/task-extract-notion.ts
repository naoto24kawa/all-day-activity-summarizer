/**
 * Task Extract Notion Handler
 *
 * Notion アイテムからのタスク抽出ジョブハンドラー
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
  workType?: string;
  confidence?: number;
  dueDate?: string;
}

interface ExtractResult {
  tasks: ExtractedTask[];
}

interface NotionProperties {
  Status?: { status?: { name?: string } };
  Priority?: { select?: { name?: string } };
  "Due Date"?: { date?: { start?: string } };
  Due?: { date?: { start?: string } };
  [key: string]: unknown;
}

/**
 * Notion アイテムからタスク抽出
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleTaskExtractNotion(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = (params.date as string) ?? getTodayDateString();
  const databaseId = params.databaseId as string | undefined;

  // 対象アイテムを取得
  const items = databaseId
    ? db
        .select()
        .from(schema.notionItems)
        .where(
          and(eq(schema.notionItems.date, date), eq(schema.notionItems.databaseId, databaseId)),
        )
        .all()
    : db.select().from(schema.notionItems).where(eq(schema.notionItems.date, date)).all();

  if (items.length === 0) {
    return {
      success: true,
      resultSummary: "対象の Notion アイテムがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  // 抽出済みのアイテムを除外
  const targetItems = items.filter((item) => !hasExtractionLog(db, "task", "notion", item.pageId));

  if (targetItems.length === 0) {
    return {
      success: true,
      resultSummary: "全ての Notion アイテムは処理済みです",
      data: { extracted: 0, tasks: [] },
    };
  }

  const vocabularySection = buildVocabularySection(db);
  const processedTasksSection = buildProcessedTasksSection(db);
  const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

  const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];

  for (const item of targetItems) {
    const userPrompt = buildNotionPrompt(item, vocabularySection, processedTasksSection);

    try {
      const response = await runClaude(userPrompt, {
        model: "haiku",
        systemPrompt,
        disableTools: true,
      });

      const parsed = parseExtractResult(response);
      let extractedCount = 0;

      if (parsed.tasks.length > 0) {
        // Notion プロパティから優先度・期限を抽出
        const properties = parseNotionProperties(item.properties);
        const notionPriority = extractPriorityFromNotion(properties);
        const notionDueDate = extractDueDateFromNotion(properties);

        for (const extractedTask of parsed.tasks) {
          const task = db
            .insert(schema.tasks)
            .values({
              date,
              projectId: item.projectId,
              sourceType: "notion",
              sourceId: item.pageId,
              title: extractedTask.title,
              description: (extractedTask.description ?? "") + `\n\n${item.url}`,
              // Notion プロパティを優先、なければ AI 抽出結果を使用
              priority: notionPriority ?? extractedTask.priority ?? null,
              workType: extractedTask.workType as typeof schema.tasks.$inferInsert.workType,
              confidence: extractedTask.confidence ?? null,
              dueDate: notionDueDate ?? extractedTask.dueDate ?? null,
            })
            .returning()
            .get();

          createdTasks.push(task);
          extractedCount++;
        }
      }

      recordExtractionLog(db, "task", "notion", item.pageId, extractedCount);
    } catch (error) {
      console.error(`Failed to extract tasks from Notion item ${item.pageId}:`, error);
    }
  }

  return {
    success: true,
    resultSummary:
      createdTasks.length > 0
        ? `Notion から ${createdTasks.length} 件のタスクを抽出しました`
        : "Notion からタスクは抽出されませんでした",
    data: { extracted: createdTasks.length, tasks: createdTasks },
  };
}

function buildNotionPrompt(
  item: typeof schema.notionItems.$inferSelect,
  vocabularySection: string,
  processedTasksSection: string,
): string {
  const properties = item.properties ? JSON.parse(item.properties) : {};
  const propsText = Object.entries(properties)
    .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
    .join("\n");

  return `以下の Notion アイテムからタスクを抽出してください。
タスク化すべき内容があればタスクとして抽出してください。
単なる情報やメモはタスクとして抽出しないでください。
${vocabularySection}${processedTasksSection}

## Notion アイテム
タイトル: ${item.title}
URL: ${item.url}

${propsText ? `## プロパティ\n${propsText}` : ""}`;
}

function parseNotionProperties(propertiesJson: string | null): NotionProperties {
  if (!propertiesJson) return {};
  try {
    return JSON.parse(propertiesJson) as NotionProperties;
  } catch {
    return {};
  }
}

function extractPriorityFromNotion(properties: NotionProperties): "high" | "medium" | "low" | null {
  const priorityProp = properties.Priority?.select?.name;
  if (!priorityProp) return null;

  const lower = priorityProp.toLowerCase();
  if (lower.includes("high") || lower.includes("urgent") || lower.includes("高")) {
    return "high";
  }
  if (lower.includes("low") || lower.includes("低")) {
    return "low";
  }
  return "medium";
}

function extractDueDateFromNotion(properties: NotionProperties): string | null {
  // "Due Date" または "Due" プロパティを探す
  const dueDate = properties["Due Date"]?.date?.start ?? properties.Due?.date?.start;
  if (!dueDate) return null;

  // YYYY-MM-DD 形式に正規化
  try {
    const date = new Date(dueDate);
    return date.toISOString().split("T")[0] ?? null;
  } catch {
    return null;
  }
}

function buildProcessedTasksSection(db: AdasDatabase): string {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0] ?? "";

  const completedTasks = db
    .select({
      title: schema.tasks.title,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "completed"), gte(schema.tasks.date, thirtyDaysAgoStr)))
    .orderBy(desc(schema.tasks.completedAt))
    .limit(10)
    .all();

  if (completedTasks.length === 0) {
    return "";
  }

  let section = "\n\n## 過去の完了済みタスク (重複回避用)\n";
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
