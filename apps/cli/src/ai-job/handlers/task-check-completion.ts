/**
 * Task Check Completion Handler
 *
 * タスク完了候補をチェックするジョブハンドラー
 * GitHub → Claude Code の順で評価
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type {
  CheckCompletionRequest,
  CheckCompletionResponse,
  SuggestCompletionsResponse,
  Task,
  TaskCompletionSuggestion,
} from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { getItemState } from "../../github/client.js";
import {
  formatChildTasksForCompletion,
  getChildTasks,
  getParentTask,
} from "../../utils/task-hierarchy.js";
import type { JobResult } from "../worker.js";

// ========== 完了チェック関数 ==========

interface CompletionCheckResult {
  reason: string;
  confidence: number;
  evidence?: string;
}

/**
 * GitHub での完了をチェック
 */
async function checkGitHubCompletion(
  db: AdasDatabase,
  task: {
    sourceType: string;
    title: string;
    description: string | null;
    githubCommentId: number | null;
  },
): Promise<CompletionCheckResult | null> {
  try {
    let owner: string | undefined;
    let repo: string | undefined;
    let number: number | undefined;

    // タイトルから {repoName}#{number} をパース
    // 例: "Review PR: my-repo#123" or "Fix Issue: my-repo#45"
    const titleMatch = task.title.match(/:\s*([^#]+)#(\d+)/);
    if (titleMatch?.[1] && titleMatch[2]) {
      repo = titleMatch[1].trim();
      number = Number.parseInt(titleMatch[2], 10);
    }

    // description から owner/repo#number をパース
    // 例: "owner/repo#123"
    if (task.description) {
      const descMatch = task.description.match(/([^/\s]+)\/([^#\s]+)#(\d+)/);
      if (descMatch?.[1] && descMatch[2] && descMatch[3]) {
        owner = descMatch[1];
        repo = descMatch[2];
        number = Number.parseInt(descMatch[3], 10);
      }
    }

    // github-comment の場合、githubCommentId から情報を取得
    if (task.sourceType === "github-comment" && task.githubCommentId) {
      const comment = db
        .select()
        .from(schema.githubComments)
        .where(eq(schema.githubComments.id, task.githubCommentId))
        .get();

      if (comment) {
        owner = comment.repoOwner;
        repo = comment.repoName;
        number = comment.itemNumber;
      }
    }

    if (!owner || !repo || !number) {
      return null;
    }

    // GitHub API で状態を確認
    const state = await getItemState(owner, repo, number);
    if (!state) {
      return null;
    }

    // PR がマージされた場合
    if (state.mergedAt) {
      return {
        reason: `${repo}#${number} がマージされました`,
        confidence: 1.0,
        evidence: `Merged at: ${state.mergedAt}`,
      };
    }

    if (state.state === "closed") {
      return {
        reason: `${repo}#${number} がクローズされました`,
        confidence: 0.9,
        evidence: `Closed at: ${state.closedAt}`,
      };
    }

    return null;
  } catch (err) {
    consola.warn("[completion-check] GitHub check failed:", err);
    return null;
  }
}

/**
 * Worker の check-completion エンドポイントを呼び出す
 */
async function callWorkerCheckCompletion(
  config: AdasConfig,
  request: CheckCompletionRequest,
): Promise<CheckCompletionResponse | null> {
  try {
    const workerUrl = config.worker?.url ?? "http://localhost:3100";

    const response = await fetch(`${workerUrl}/rpc/check-completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      consola.warn(`[completion-check] Worker returned ${response.status}`);
      return null;
    }

    return (await response.json()) as CheckCompletionResponse;
  } catch (err) {
    consola.warn("[completion-check] Worker call failed:", err);
    return null;
  }
}

/**
 * Claude Code セッションでの完了をチェック
 */
async function checkClaudeCodeCompletion(
  db: AdasDatabase,
  config: AdasConfig,
  task: {
    id: number;
    projectId: number | null;
    title: string;
    description: string | null;
    acceptedAt: string | null;
    parentId: number | null;
  },
): Promise<CompletionCheckResult | null> {
  if (!task.projectId) {
    return null;
  }

  try {
    // プロジェクトの path を取得
    const project = db
      .select({ path: schema.projects.path })
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))
      .get();

    if (!project?.path) {
      return null;
    }

    // タスク承認日以降のセッションを取得
    const sessions = db
      .select()
      .from(schema.claudeCodeSessions)
      .where(
        and(
          eq(schema.claudeCodeSessions.projectPath, project.path),
          task.acceptedAt ? gte(schema.claudeCodeSessions.startTime, task.acceptedAt) : undefined,
        ),
      )
      .orderBy(desc(schema.claudeCodeSessions.startTime))
      .limit(5)
      .all();

    if (sessions.length === 0) {
      return null;
    }

    // セッションのメッセージを取得してコンテキストを構築
    const contextParts: string[] = [];
    for (const session of sessions) {
      const messages = db
        .select()
        .from(schema.claudeCodeMessages)
        .where(eq(schema.claudeCodeMessages.sessionId, session.sessionId))
        .orderBy(desc(schema.claudeCodeMessages.timestamp))
        .limit(10)
        .all();

      if (messages.length > 0) {
        contextParts.push(`--- セッション (${session.startTime}) ---`);
        for (const msg of messages.reverse()) {
          const role = msg.role === "user" ? "User" : "Assistant";
          contextParts.push(`[${role}] ${msg.content.slice(0, 500)}`);
        }
      }
    }

    if (contextParts.length === 0) {
      return null;
    }

    const context = contextParts.join("\n");

    // 子タスク・親タスク情報を取得
    const childTasks = getChildTasks(db, task.id);
    const parentTask = task.parentId ? getParentTask(db, task) : null;

    // Worker で AI 判定
    const result = await callWorkerCheckCompletion(config, {
      task: {
        title: task.title,
        description: task.description,
        childTasks: childTasks.length > 0 ? formatChildTasksForCompletion(childTasks) : undefined,
        parentTask: parentTask ? { id: parentTask.id, title: parentTask.title } : undefined,
      },
      context,
      source: "claude-code",
    });

    if (result?.completed) {
      return {
        reason: result.reason,
        confidence: result.confidence,
        evidence: result.evidence,
      };
    }

    return null;
  } catch (err) {
    consola.warn("[completion-check] Claude Code check failed:", err);
    return null;
  }
}

// ========== ジョブハンドラー ==========

/**
 * タスク完了チェックジョブハンドラー
 */
export async function handleTaskCheckCompletion(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const date = params.date as string | undefined;

  // accepted 状態のタスクを取得
  const conditions = [eq(schema.tasks.status, "accepted")];
  if (date) {
    conditions.push(eq(schema.tasks.date, date));
  }

  const acceptedTasks = db
    .select()
    .from(schema.tasks)
    .where(and(...conditions))
    .orderBy(desc(schema.tasks.acceptedAt))
    .all();

  if (acceptedTasks.length === 0) {
    const result: SuggestCompletionsResponse = {
      suggestions: [],
      evaluated: { total: 0, github: 0, claudeCode: 0 },
    };
    return {
      success: true,
      resultSummary: "承認済みタスクがありません",
      data: result,
    };
  }

  const suggestions: TaskCompletionSuggestion[] = [];
  const evaluated = { total: 0, github: 0, claudeCode: 0 };

  for (const task of acceptedTasks) {
    evaluated.total++;

    // 1. GitHub 評価 (確実性: 最高)
    if (task.sourceType === "github" || task.sourceType === "github-comment") {
      evaluated.github++;
      const result = await checkGitHubCompletion(db, task);
      if (result) {
        suggestions.push({
          taskId: task.id,
          task: task as Task,
          source: "github",
          reason: result.reason,
          confidence: result.confidence,
          evidence: result.evidence,
        });
        continue; // 早期リターン
      }
    }

    // 2. Claude Code 評価 (AI判定)
    if (task.projectId) {
      evaluated.claudeCode++;
      const result = await checkClaudeCodeCompletion(db, config, task);
      if (result) {
        suggestions.push({
          taskId: task.id,
          task: task as Task,
          source: "claude-code",
          reason: result.reason,
          confidence: result.confidence,
          evidence: result.evidence,
        });
      }
    }
  }

  const resultData: SuggestCompletionsResponse = {
    suggestions,
    evaluated,
  };

  return {
    success: true,
    resultSummary: `${suggestions.length}件の完了候補を検出 (${evaluated.total}件を評価)`,
    data: resultData,
  };
}
