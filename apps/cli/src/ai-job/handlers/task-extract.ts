/**
 * Task Extract Handlers
 *
 * Slack/GitHub/Memo からのタスク抽出ジョブハンドラー
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { loadConfig } from "../../config.js";
import { hasExtractionLog, recordExtractionLog } from "../../utils/extraction-log.js";
import { findOrCreateProjectByGitHub } from "../../utils/project-lookup.js";
import { buildVocabularySection } from "../../utils/vocabulary.js";
import type { JobResult } from "../worker.js";

interface ExtractedTaskDependency {
  type: "blocks" | "related";
  taskTitle: string;
  reason: string;
  confidence: number;
}

interface ExtractedTask {
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  confidence?: number;
  dueDate?: string;
  similarTo?: {
    title: string;
    status: "completed" | "rejected";
    reason: string;
  };
  dependencies?: ExtractedTaskDependency[];
}

interface ExtractResult {
  tasks: ExtractedTask[];
}

interface TaskWithDependencies {
  task: typeof schema.tasks.$inferSelect;
  extractedDependencies: ExtractedTaskDependency[];
}

// ========== Slack 抽出 ==========

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleTaskExtractSlack(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = (params.date as string) ?? getTodayDateString();
  const messageIds = params.messageIds as number[] | undefined;

  // 対象メッセージを取得
  let messages: (typeof schema.slackMessages.$inferSelect)[];
  if (messageIds && messageIds.length > 0) {
    messages = db
      .select()
      .from(schema.slackMessages)
      .where(inArray(schema.slackMessages.id, messageIds))
      .all();
  } else {
    messages = db
      .select()
      .from(schema.slackMessages)
      .where(
        and(
          eq(schema.slackMessages.date, date),
          inArray(schema.slackMessages.messageType, ["mention", "dm"]),
        ),
      )
      .all();
  }

  if (messages.length === 0) {
    return {
      success: true,
      resultSummary: "対象メッセージがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  // 既に抽出済みのメッセージを除外
  const targetMessages = messages.filter(
    (m) => !hasExtractionLog(db, "task", "slack", String(m.id)),
  );

  if (targetMessages.length === 0) {
    return {
      success: true,
      resultSummary: "全てのメッセージは処理済みです",
      data: { extracted: 0, tasks: [] },
    };
  }

  const { fewShotExamples, vocabularySection, processedTasksSection, systemPrompt } =
    prepareExtraction(db);

  const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];
  const tasksWithDeps: TaskWithDependencies[] = [];

  for (const message of targetMessages) {
    const userPrompt = buildSlackPrompt(
      message,
      fewShotExamples,
      vocabularySection,
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
        for (const extractedTask of parsed.tasks) {
          const task = db
            .insert(schema.tasks)
            .values({
              date,
              slackMessageId: message.id,
              sourceType: "slack",
              title: extractedTask.title,
              description: extractedTask.description ?? null,
              priority: extractedTask.priority ?? null,
              confidence: extractedTask.confidence ?? null,
              dueDate: extractedTask.dueDate ?? null,
              similarToTitle: extractedTask.similarTo?.title ?? null,
              similarToStatus: extractedTask.similarTo?.status ?? null,
              similarToReason: extractedTask.similarTo?.reason ?? null,
            })
            .returning()
            .get();

          createdTasks.push(task);
          extractedCount++;

          if (extractedTask.dependencies && extractedTask.dependencies.length > 0) {
            tasksWithDeps.push({
              task,
              extractedDependencies: extractedTask.dependencies,
            });
          }
        }
      }

      recordExtractionLog(db, "task", "slack", String(message.id), extractedCount);
    } catch (error) {
      console.error(`Failed to extract tasks from message ${message.id}:`, error);
    }
  }

  // 依存関係を保存
  if (tasksWithDeps.length > 0) {
    saveDependencies(db, tasksWithDeps);
  }

  return {
    success: true,
    resultSummary:
      createdTasks.length > 0
        ? `Slackから${createdTasks.length}件のタスクを抽出しました`
        : "Slackからタスクは抽出されませんでした",
    data: { extracted: createdTasks.length, tasks: createdTasks },
  };
}

// ========== GitHub Items 抽出 ==========

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleTaskExtractGitHub(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = (params.date as string) ?? getTodayDateString();
  const githubUsername = config.github.username;

  if (!githubUsername) {
    return {
      success: false,
      resultSummary: "GitHub usernameが設定されていません",
    };
  }

  // レビュー依頼された PR を取得
  const reviewRequestedPRs = db
    .select()
    .from(schema.githubItems)
    .where(
      and(
        eq(schema.githubItems.date, date),
        eq(schema.githubItems.itemType, "pull_request"),
        eq(schema.githubItems.isReviewRequested, true),
        eq(schema.githubItems.state, "open"),
      ),
    )
    .all();

  // 自分がアサインされた Issue を取得
  const assignedIssues = db
    .select()
    .from(schema.githubItems)
    .where(
      and(
        eq(schema.githubItems.date, date),
        eq(schema.githubItems.itemType, "issue"),
        eq(schema.githubItems.state, "open"),
        eq(schema.githubItems.assigneeLogin, githubUsername),
      ),
    )
    .all();

  const allItems = [...reviewRequestedPRs, ...assignedIssues];

  if (allItems.length === 0) {
    return {
      success: true,
      resultSummary: "対象のGitHub Itemsがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  // 既存のタスクと重複チェック
  const existingTaskTitles = db
    .select({ title: schema.tasks.title })
    .from(schema.tasks)
    .where(eq(schema.tasks.date, date))
    .all()
    .map((t) => t.title);

  const createdTasks = [];

  for (const item of allItems) {
    const projectId = findOrCreateProjectByGitHub(db, item.repoOwner, item.repoName);

    if (item.itemType === "pull_request" && item.isReviewRequested) {
      const title = `Review PR: ${item.repoName}#${item.number}`;
      if (!existingTaskTitles.includes(title)) {
        const task = db
          .insert(schema.tasks)
          .values({
            date,
            slackMessageId: null,
            projectId,
            sourceType: "github",
            title,
            description: `${item.title}\n\n${item.url}`,
            priority: "high",
            confidence: 1.0,
            dueDate: null,
          })
          .returning()
          .get();
        createdTasks.push(task);
        existingTaskTitles.push(title);
      }
    }

    if (item.itemType === "issue") {
      const title = `Fix Issue: ${item.repoName}#${item.number}`;
      if (!existingTaskTitles.includes(title)) {
        const task = db
          .insert(schema.tasks)
          .values({
            date,
            slackMessageId: null,
            projectId,
            sourceType: "github",
            title,
            description: `${item.title}\n\n${item.url}`,
            priority: "medium",
            confidence: 1.0,
            dueDate: null,
          })
          .returning()
          .get();
        createdTasks.push(task);
        existingTaskTitles.push(title);
      }
    }
  }

  return {
    success: true,
    resultSummary:
      createdTasks.length > 0
        ? `GitHubから${createdTasks.length}件のタスクを抽出しました`
        : "GitHubからタスクは抽出されませんでした",
    data: { extracted: createdTasks.length, tasks: createdTasks },
  };
}

// ========== GitHub Comments 抽出 ==========

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleTaskExtractGitHubComment(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = (params.date as string) ?? getTodayDateString();
  const githubUsername = config.github.username;

  if (!githubUsername) {
    return {
      success: false,
      resultSummary: "GitHub usernameが設定されていません",
    };
  }

  const allComments = db
    .select()
    .from(schema.githubComments)
    .where(eq(schema.githubComments.date, date))
    .all();

  const mentionPattern = new RegExp(`@${githubUsername}\\b`, "i");
  const comments = allComments.filter(
    (c) => c.authorLogin !== githubUsername && mentionPattern.test(c.body),
  );

  if (comments.length === 0) {
    return {
      success: true,
      resultSummary: "対象のGitHubコメントがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  const targetComments = comments.filter(
    (c) => !hasExtractionLog(db, "task", "github-comment", String(c.id)),
  );

  if (targetComments.length === 0) {
    return {
      success: true,
      resultSummary: "全てのコメントは処理済みです",
      data: { extracted: 0, tasks: [] },
    };
  }

  const { fewShotExamples, vocabularySection, processedTasksSection, systemPrompt } =
    prepareExtraction(db);

  const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];
  const tasksWithDeps: TaskWithDependencies[] = [];

  for (const comment of targetComments) {
    const projectId = findOrCreateProjectByGitHub(db, comment.repoOwner, comment.repoName);
    const userPrompt = buildGitHubCommentPrompt(
      comment,
      fewShotExamples,
      vocabularySection,
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
        for (const extractedTask of parsed.tasks) {
          const task = db
            .insert(schema.tasks)
            .values({
              date,
              slackMessageId: null,
              githubCommentId: comment.id,
              projectId,
              sourceType: "github-comment",
              title: extractedTask.title,
              description:
                (extractedTask.description ?? "") +
                `\n\n${comment.repoOwner}/${comment.repoName}#${comment.itemNumber}\n${comment.url}`,
              priority: extractedTask.priority ?? null,
              confidence: extractedTask.confidence ?? null,
              dueDate: extractedTask.dueDate ?? null,
              similarToTitle: extractedTask.similarTo?.title ?? null,
              similarToStatus: extractedTask.similarTo?.status ?? null,
              similarToReason: extractedTask.similarTo?.reason ?? null,
            })
            .returning()
            .get();

          createdTasks.push(task);
          extractedCount++;

          if (extractedTask.dependencies && extractedTask.dependencies.length > 0) {
            tasksWithDeps.push({
              task,
              extractedDependencies: extractedTask.dependencies,
            });
          }
        }
      }

      recordExtractionLog(db, "task", "github-comment", String(comment.id), extractedCount);
    } catch (error) {
      console.error(`Failed to extract tasks from comment ${comment.id}:`, error);
    }
  }

  if (tasksWithDeps.length > 0) {
    saveDependencies(db, tasksWithDeps);
  }

  return {
    success: true,
    resultSummary:
      createdTasks.length > 0
        ? `GitHubコメントから${createdTasks.length}件のタスクを抽出しました`
        : "GitHubコメントからタスクは抽出されませんでした",
    data: { extracted: createdTasks.length, tasks: createdTasks },
  };
}

// ========== Memo 抽出 ==========

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex extraction logic
export async function handleTaskExtractMemo(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = (params.date as string) ?? getTodayDateString();

  const memos = db.select().from(schema.memos).where(eq(schema.memos.date, date)).all();

  if (memos.length === 0) {
    return {
      success: true,
      resultSummary: "対象のメモがありません",
      data: { extracted: 0, tasks: [] },
    };
  }

  const targetMemos = memos.filter((m) => !hasExtractionLog(db, "task", "memo", String(m.id)));

  if (targetMemos.length === 0) {
    return {
      success: true,
      resultSummary: "全てのメモは処理済みです",
      data: { extracted: 0, tasks: [] },
    };
  }

  const { fewShotExamples, vocabularySection, processedTasksSection, systemPrompt } =
    prepareExtraction(db);

  const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];
  const tasksWithDeps: TaskWithDependencies[] = [];

  for (const memo of targetMemos) {
    const userPrompt = buildMemoPrompt(
      memo,
      fewShotExamples,
      vocabularySection,
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
        for (const extractedTask of parsed.tasks) {
          const task = db
            .insert(schema.tasks)
            .values({
              date,
              slackMessageId: null,
              memoId: memo.id,
              sourceType: "memo",
              title: extractedTask.title,
              description: extractedTask.description ?? null,
              priority: extractedTask.priority ?? null,
              confidence: extractedTask.confidence ?? null,
              dueDate: extractedTask.dueDate ?? null,
              similarToTitle: extractedTask.similarTo?.title ?? null,
              similarToStatus: extractedTask.similarTo?.status ?? null,
              similarToReason: extractedTask.similarTo?.reason ?? null,
            })
            .returning()
            .get();

          createdTasks.push(task);
          extractedCount++;

          if (extractedTask.dependencies && extractedTask.dependencies.length > 0) {
            tasksWithDeps.push({
              task,
              extractedDependencies: extractedTask.dependencies,
            });
          }
        }
      }

      recordExtractionLog(db, "task", "memo", String(memo.id), extractedCount);
    } catch (error) {
      console.error(`Failed to extract tasks from memo ${memo.id}:`, error);
    }
  }

  if (tasksWithDeps.length > 0) {
    saveDependencies(db, tasksWithDeps);
  }

  return {
    success: true,
    resultSummary:
      createdTasks.length > 0
        ? `メモから${createdTasks.length}件のタスクを抽出しました`
        : "メモからタスクは抽出されませんでした",
    data: { extracted: createdTasks.length, tasks: createdTasks },
  };
}

// ========== ヘルパー関数 ==========

function getTodayDateString(): string {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jst = new Date(now.getTime() + jstOffset);
  return jst.toISOString().split("T")[0] ?? "";
}

function prepareExtraction(db: AdasDatabase) {
  const fewShotExamples = buildFewShotExamples(db);
  const vocabularySection = buildVocabularySection(db);
  const processedTasksSection = buildProcessedTasksSection(db);
  const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

  return { fewShotExamples, vocabularySection, processedTasksSection, systemPrompt };
}

function buildFewShotExamples(db: AdasDatabase): string {
  const acceptedTasks = db
    .select({
      title: schema.tasks.title,
      slackMessageId: schema.tasks.slackMessageId,
      originalTitle: schema.tasks.originalTitle,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.status, "accepted"))
    .orderBy(desc(schema.tasks.acceptedAt))
    .limit(10)
    .all();

  const acceptedWithoutCorrection = acceptedTasks.filter((t) => !t.originalTitle).slice(0, 5);
  const acceptedWithCorrection = acceptedTasks.filter((t) => t.originalTitle).slice(0, 5);

  const rejectedTasks = db
    .select({
      title: schema.tasks.title,
      slackMessageId: schema.tasks.slackMessageId,
      rejectReason: schema.tasks.rejectReason,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.status, "rejected"))
    .orderBy(desc(schema.tasks.rejectedAt))
    .limit(5)
    .all();

  if (
    acceptedWithoutCorrection.length === 0 &&
    acceptedWithCorrection.length === 0 &&
    rejectedTasks.length === 0
  ) {
    return "";
  }

  let examples = "\n\n## 過去の判断例\n";

  if (acceptedWithoutCorrection.length > 0) {
    examples += "\n### タスクとして承認されたもの:\n";
    for (const task of acceptedWithoutCorrection) {
      if (task.slackMessageId) {
        const message = db
          .select({ text: schema.slackMessages.text })
          .from(schema.slackMessages)
          .where(eq(schema.slackMessages.id, task.slackMessageId))
          .get();
        if (message) {
          examples += `- メッセージ: "${message.text.slice(0, 100)}"\n  → タスク: "${task.title}"\n`;
        }
      }
    }
  }

  if (acceptedWithCorrection.length > 0) {
    examples += "\n### 修正して承認されたもの (元の抽出は改善が必要):\n";
    for (const task of acceptedWithCorrection) {
      if (task.slackMessageId) {
        const message = db
          .select({ text: schema.slackMessages.text })
          .from(schema.slackMessages)
          .where(eq(schema.slackMessages.id, task.slackMessageId))
          .get();
        if (message) {
          examples += `- メッセージ: "${message.text.slice(0, 100)}"\n`;
          examples += `  → 元の抽出: "${task.originalTitle}"\n`;
          examples += `  → 修正後: "${task.title}"\n`;
        }
      }
    }
  }

  if (rejectedTasks.length > 0) {
    examples += "\n### タスクとして却下されたもの:\n";
    for (const task of rejectedTasks) {
      if (task.slackMessageId) {
        const message = db
          .select({ text: schema.slackMessages.text })
          .from(schema.slackMessages)
          .where(eq(schema.slackMessages.id, task.slackMessageId))
          .get();
        if (message) {
          const reason = task.rejectReason ? ` (理由: ${task.rejectReason})` : "";
          examples += `- メッセージ: "${message.text.slice(0, 100)}"${reason}\n  → タスク化不要\n`;
        }
      }
    }
  }

  return examples;
}

function buildProcessedTasksSection(db: AdasDatabase): string {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0] ?? "";

  const completedTasks = db
    .select({
      title: schema.tasks.title,
      description: schema.tasks.description,
      completedAt: schema.tasks.completedAt,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "completed"), gte(schema.tasks.date, thirtyDaysAgoStr)))
    .orderBy(desc(schema.tasks.completedAt))
    .limit(20)
    .all();

  const rejectedTasks = db
    .select({
      title: schema.tasks.title,
      description: schema.tasks.description,
      rejectReason: schema.tasks.rejectReason,
      rejectedAt: schema.tasks.rejectedAt,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "rejected"), gte(schema.tasks.date, thirtyDaysAgoStr)))
    .orderBy(desc(schema.tasks.rejectedAt))
    .limit(20)
    .all();

  if (completedTasks.length === 0 && rejectedTasks.length === 0) {
    return "";
  }

  let section = "\n\n## 過去の処理済みタスク (類似チェック用)\n";
  section +=
    "新しいタスクがこれらに類似している場合は、`similarTo` フィールドで報告してください。\n";

  if (completedTasks.length > 0) {
    section += "\n### 完了済みタスク:\n";
    for (const task of completedTasks) {
      section += `- ${task.title}`;
      if (task.description) {
        section += ` (${task.description.slice(0, 50)}...)`;
      }
      section += "\n";
    }
  }

  if (rejectedTasks.length > 0) {
    section += "\n### 却下されたタスク:\n";
    for (const task of rejectedTasks) {
      section += `- ${task.title}`;
      if (task.rejectReason) {
        section += ` (却下理由: ${task.rejectReason})`;
      }
      section += "\n";
    }
  }

  return section;
}

function buildSlackPrompt(
  message: { text: string; userName: string | null; channelName: string | null },
  fewShotExamples: string,
  vocabularySection: string,
  processedTasksSection: string,
): string {
  const context = [];
  if (message.userName) {
    context.push(`送信者: ${message.userName}`);
  }
  if (message.channelName) {
    context.push(`チャンネル: ${message.channelName}`);
  }

  return `以下のSlackメッセージからタスクを抽出してください。
${fewShotExamples}${vocabularySection}${processedTasksSection}

## メッセージ
${context.length > 0 ? `${context.join(" / ")}\n` : ""}
${message.text}`;
}

function buildGitHubCommentPrompt(
  comment: {
    body: string;
    authorLogin: string | null;
    commentType: string;
    repoName: string;
    itemNumber: number;
  },
  fewShotExamples: string,
  vocabularySection: string,
  processedTasksSection: string,
): string {
  const context = [];
  if (comment.authorLogin) {
    context.push(`投稿者: ${comment.authorLogin}`);
  }
  context.push(`タイプ: ${comment.commentType}`);
  context.push(`リポジトリ: ${comment.repoName}#${comment.itemNumber}`);

  return `以下のGitHubコメントからタスクを抽出してください。
レビュー指摘や質問、依頼事項があればタスク化してください。
${fewShotExamples}${vocabularySection}${processedTasksSection}

## コメント
${context.join(" / ")}

${comment.body}`;
}

function buildMemoPrompt(
  memo: { content: string; createdAt: string },
  fewShotExamples: string,
  vocabularySection: string,
  processedTasksSection: string,
): string {
  return `以下のメモからタスクを抽出してください。
TODO、やること、対応が必要な内容があればタスク化してください。
${fewShotExamples}${vocabularySection}${processedTasksSection}

## メモ (${memo.createdAt})
${memo.content}`;
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

function saveDependencies(db: AdasDatabase, tasksWithDeps: TaskWithDependencies[]): void {
  // 同一バッチ内のタスクタイトルを収集
  const titleToTaskId = new Map<string, number>();
  for (const { task } of tasksWithDeps) {
    titleToTaskId.set(task.title, task.id);
  }

  for (const { task, extractedDependencies } of tasksWithDeps) {
    for (const dep of extractedDependencies) {
      // 同一バッチ内タスクを探す
      let dependsOnTaskId = titleToTaskId.get(dep.taskTitle);

      // バッチ内になければ既存タスクを探す
      if (!dependsOnTaskId) {
        const existingTask = db
          .select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(eq(schema.tasks.title, dep.taskTitle))
          .get();

        if (existingTask) {
          dependsOnTaskId = existingTask.id;
        }
      }

      if (dependsOnTaskId && dependsOnTaskId !== task.id) {
        // 重複チェック
        const existing = db
          .select()
          .from(schema.taskDependencies)
          .where(
            and(
              eq(schema.taskDependencies.taskId, task.id),
              eq(schema.taskDependencies.dependsOnTaskId, dependsOnTaskId),
            ),
          )
          .get();

        if (!existing) {
          db.insert(schema.taskDependencies)
            .values({
              taskId: task.id,
              dependsOnTaskId,
              dependencyType: dep.type,
              confidence: dep.confidence,
              reason: dep.reason,
              sourceType: "auto",
            })
            .run();
        }
      }
    }
  }
}
