/**
 * Task Extract Claude Code Handler
 *
 * Claude Code セッションからのタスク抽出ジョブハンドラー
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, desc, eq, gte } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { hasExtractionLog, recordExtractionLog } from "../../utils/extraction-log.js";
import { findProjectByPath } from "../../utils/project-lookup.js";
import { buildVocabularySection } from "../../utils/vocabulary.js";
import type { JobResult } from "../worker.js";

interface ExtractedTask {
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  workType?: string;
  confidence?: number;
}

interface ExtractResult {
  tasks: ExtractedTask[];
}

interface UserProfileContext {
  specialties?: string[];
  knownTechnologies?: string[];
  learningGoals?: string[];
}

/**
 * Claude Code セッションからタスク抽出
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleTaskExtractClaudeCode(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = (params.date as string) ?? getTodayDateString();
  const confidenceThreshold = (params.confidenceThreshold as number) ?? 0.5;

  // 対象セッションを取得
  const sessions = db
    .select()
    .from(schema.claudeCodeSessions)
    .where(eq(schema.claudeCodeSessions.date, date))
    .all();

  if (sessions.length === 0) {
    return {
      success: true,
      resultSummary: "対象の Claude Code セッションがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  // プロフィール情報を取得
  const profileContext = getUserProfileContext(db);

  const vocabularySection = buildVocabularySection(db);
  const profileSection = buildProfileSection(profileContext);
  const processedTasksSection = buildProcessedTasksSection(db);
  const systemPrompt = readFileSync(getPromptFilePath("task-extract-claude-code"), "utf-8");

  const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];

  for (const session of sessions) {
    // 抽出済みチェック
    if (hasExtractionLog(db, "task", "claude-code", session.sessionId)) {
      continue;
    }

    // セッションのメッセージを取得 (sessionId は文字列)
    const messages = db
      .select()
      .from(schema.claudeCodeMessages)
      .where(eq(schema.claudeCodeMessages.sessionId, session.sessionId))
      .orderBy(schema.claudeCodeMessages.timestamp)
      .all();

    if (messages.length === 0) {
      recordExtractionLog(db, "task", "claude-code", session.sessionId, 0);
      continue;
    }

    // メッセージを会話形式にフォーマット
    const conversationText = messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n");

    // 長すぎる場合は末尾を切り詰め
    const truncatedText =
      conversationText.length > 15000 ? conversationText.slice(-15000) : conversationText;

    const userPrompt = buildClaudeCodePrompt(
      session.projectName ?? session.projectPath,
      truncatedText,
      vocabularySection,
      profileSection,
      processedTasksSection,
    );

    try {
      const response = await runClaude(userPrompt, {
        model: "haiku",
        systemPrompt,
        disableTools: true,
      });

      const parsed = parseExtractResult(response);
      let extractedCount = 0;

      if (parsed.tasks.length > 0) {
        // プロジェクト紐付け
        const projectId = findProjectByPath(db, session.projectPath);

        for (const extractedTask of parsed.tasks) {
          // confidence threshold でフィルタ
          if ((extractedTask.confidence ?? 0.5) < confidenceThreshold) {
            continue;
          }

          const task = db
            .insert(schema.tasks)
            .values({
              date,
              claudeCodeSessionId: session.id,
              projectId,
              sourceType: "claude-code",
              title: extractedTask.title,
              description:
                (extractedTask.description ?? "") +
                `\n\n(Claude Code セッション: ${session.projectName ?? session.projectPath})`,
              priority: extractedTask.priority ?? null,
              workType: extractedTask.workType as typeof schema.tasks.$inferInsert.workType,
              confidence: extractedTask.confidence ?? null,
            })
            .returning()
            .get();

          createdTasks.push(task);
          extractedCount++;
        }
      }

      recordExtractionLog(db, "task", "claude-code", session.sessionId, extractedCount);
    } catch (error) {
      console.error(
        `Failed to extract tasks from Claude Code session ${session.sessionId}:`,
        error,
      );
    }
  }

  return {
    success: true,
    resultSummary:
      createdTasks.length > 0
        ? `Claude Code から ${createdTasks.length} 件のタスクを抽出しました`
        : "Claude Code からタスクは抽出されませんでした",
    data: { extracted: createdTasks.length, tasks: createdTasks },
  };
}

function buildClaudeCodePrompt(
  projectName: string,
  conversationText: string,
  vocabularySection: string,
  profileSection: string,
  processedTasksSection: string,
): string {
  return `以下の Claude Code セッションの会話ログからタスクを抽出してください。
${vocabularySection}${profileSection}${processedTasksSection}

## プロジェクト
${projectName}

## 会話ログ
${conversationText}`;
}

/**
 * ユーザープロフィール情報を取得
 */
function getUserProfileContext(db: AdasDatabase): UserProfileContext | null {
  const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

  if (!profile) {
    return null;
  }

  return {
    specialties: profile.specialties ? JSON.parse(profile.specialties) : undefined,
    knownTechnologies: profile.knownTechnologies
      ? JSON.parse(profile.knownTechnologies)
      : undefined,
    learningGoals: profile.learningGoals ? JSON.parse(profile.learningGoals) : undefined,
  };
}

/**
 * プロフィールセクションを構築
 */
function buildProfileSection(profile: UserProfileContext | null): string {
  if (!profile) {
    return "";
  }

  const lines: string[] = [];

  if (profile.learningGoals && profile.learningGoals.length > 0) {
    lines.push(`\n## 学習目標 (優先度を上げる)`);
    lines.push(`以下に関連するタスクは優先度を高めに設定してください:`);
    lines.push(profile.learningGoals.join(", "));
  }

  if (profile.specialties && profile.specialties.length > 0) {
    lines.push(`\n## 専門分野`);
    lines.push(profile.specialties.join(", "));
  }

  if (profile.knownTechnologies && profile.knownTechnologies.length > 0) {
    lines.push(`\n## 既知の技術`);
    lines.push(profile.knownTechnologies.join(", "));
  }

  return lines.length > 0 ? lines.join("\n") : "";
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
