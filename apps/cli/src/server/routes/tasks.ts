/**
 * Tasks API Routes
 *
 * Slack メッセージから抽出したタスクの管理
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { getPromptFilePath, type LogEntry, readLogFile, runClaude } from "@repo/core";
import type { AdasDatabase, SlackMessage } from "@repo/db";
import { schema } from "@repo/db";
import {
  type BulkElaborateStartResponse,
  type BulkElaborateTasksRequest,
  type BulkElaborationStatusResponse,
  type CheckCompletionRequest,
  type CheckCompletionResponse,
  type CheckDuplicatesResponse,
  type CheckSimilarityBatchRequest,
  type CheckSimilarityBatchResponse,
  type CheckTaskSimilarityResponse,
  type CreateGitHubIssueRequest,
  type CreateGitHubIssueResponse,
  type CreateMergeTaskResponse,
  type DetectDuplicatesResponse,
  type ElaborateTaskRequest,
  type ElaborationStatus,
  isApprovalOnlyTask,
  type PromptTarget,
  type SimilarityCheckResult,
  type SuggestCompletionsResponse,
  type Task,
  type TaskCompletionSuggestion,
  type TaskStatus,
  type WorkType,
} from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import { loadConfig } from "../../config";
import { createIssue, getItemState } from "../../github/client";
import { getTodayDateString } from "../../utils/date";
import { hasExtractionLog, recordExtractionLog } from "../../utils/extraction-log.js";
import { findOrCreateProjectByGitHub } from "../../utils/project-lookup.js";
import {
  formatChildTasksForCompletion,
  getChildTasks,
  getParentTask,
} from "../../utils/task-hierarchy.js";
import { buildVocabularySection } from "../../utils/vocabulary.js";

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
  workType?: WorkType;
  confidence?: number;
  dueDate?: string;
  similarTo?: {
    title: string;
    status: "completed" | "rejected";
    reason: string;
  };
  dependencies?: ExtractedTaskDependency[];
}

/**
 * タスクのアクションコマンドを生成
 */
function buildTaskActionCommands(
  baseUrl: string,
  taskId: number,
  format: "detailed" | "compact",
): string {
  const startUrl = `${baseUrl}/api/tasks/${taskId}/start`;
  const completeUrl = `${baseUrl}/api/tasks/${taskId}/complete`;
  const pauseUrl = `${baseUrl}/api/tasks/${taskId}/pause`;

  if (format === "detailed") {
    let text = "---\n";
    text += "作業開始前に以下を実行してください:\n";
    text += "```bash\n";
    text += `curl -X POST ${startUrl}\n`;
    text += "```\n\n";
    text += "タスク完了時は以下を実行してください:\n";
    text += "```bash\n";
    text += `curl -X POST ${completeUrl}\n`;
    text += "```\n\n";
    text += "中断する場合は以下を実行してください (理由は任意):\n";
    text += "```bash\n";
    text += `curl -X POST ${pauseUrl} -H "Content-Type: application/json" -d '{"reason": "中断理由"}'\n`;
    text += "```";
    return text;
  }

  // compact format
  const lines: string[] = [];
  lines.push("アクション:");
  lines.push(`- 開始: curl -X POST ${startUrl}`);
  lines.push(`- 完了: curl -X POST ${completeUrl}`);
  lines.push(
    `- 中断: curl -X POST ${pauseUrl} -H "Content-Type: application/json" -d '{"reason": "理由"}'`,
  );
  return lines.join("\n");
}

interface ExtractResult {
  tasks: ExtractedTask[];
}

/**
 * タスク更新用の型定義
 */
interface TaskUpdates {
  updatedAt: string;
  projectId?: number | null;
  priority?: "high" | "medium" | "low" | null;
  workType?: WorkType | null;
  status?: TaskStatus;
  acceptedAt?: string;
  rejectedAt?: string;
  rejectReason?: string;
  startedAt?: string;
  pausedAt?: string;
  pauseReason?: string;
  completedAt?: string;
  dueDate?: string | null;
  title?: string;
  description?: string;
  originalTitle?: string | null;
  originalDescription?: string | null;
}

/** 有効なタスクステータス */
const VALID_TASK_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "in_progress",
  "paused",
  "completed",
] as const;

/** クエリパラメータが有効な TaskStatus かどうかを判定 */
function isValidTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (VALID_TASK_STATUSES as readonly string[]).includes(value);
}

export function createTasksRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/tasks
   *
   * Query params:
   * - status: pending | accepted | rejected | completed (optional)
   * - projectId: number (optional, filters by project)
   * - noProject: boolean (optional, filters tasks without project)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const statusParam = c.req.query("status");
    const status = isValidTaskStatus(statusParam) ? statusParam : undefined;
    const projectIdStr = c.req.query("projectId");
    const noProject = c.req.query("noProject") === "true";
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    const conditions = [];

    if (status) {
      conditions.push(eq(schema.tasks.status, status));
    }

    if (projectIdStr) {
      const projectId = Number.parseInt(projectIdStr, 10);
      if (!Number.isNaN(projectId)) {
        conditions.push(eq(schema.tasks.projectId, projectId));
      }
    } else if (noProject) {
      conditions.push(isNull(schema.tasks.projectId));
    }

    let query = db.select().from(schema.tasks).orderBy(desc(schema.tasks.extractedAt)).limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const tasks = query.all();

    // vocabulary タスクの場合、用語提案の sourceType を取得して付加
    const tasksWithVocabSource = tasks.map((task) => {
      if (task.sourceType === "vocabulary" && task.vocabularySuggestionId) {
        const suggestion = db
          .select({ sourceType: schema.vocabularySuggestions.sourceType })
          .from(schema.vocabularySuggestions)
          .where(eq(schema.vocabularySuggestions.id, task.vocabularySuggestionId))
          .get();
        return {
          ...task,
          vocabularySuggestionSourceType: suggestion?.sourceType ?? null,
        };
      }
      return task;
    });

    return c.json(tasksWithVocabSource);
  });

  /**
   * GET /api/tasks/for-ai
   *
   * AIエージェント向けのタスク一覧 (Markdown形式)
   * - accepted 状態のタスクのみ
   * - 優先度順にソート (ブロックされているタスクは後回し)
   * - 各タスクにアクションURL付き
   * - ブロック情報を表示
   *
   * Query params:
   * - date: YYYY-MM-DD (optional)
   * - projectId: number (optional)
   * - limit: number (optional, defaults to 20)
   */
  router.get("/for-ai", (c) => {
    const date = c.req.query("date");
    const projectIdStr = c.req.query("projectId");
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 20;

    const conditions = [eq(schema.tasks.status, "accepted")];

    if (date) {
      conditions.push(eq(schema.tasks.date, date));
    }

    if (projectIdStr) {
      const projectId = Number.parseInt(projectIdStr, 10);
      if (!Number.isNaN(projectId)) {
        conditions.push(eq(schema.tasks.projectId, projectId));
      }
    }

    const tasks = db
      .select()
      .from(schema.tasks)
      .where(and(...conditions))
      .orderBy(desc(schema.tasks.priority), desc(schema.tasks.acceptedAt))
      .limit(limit)
      .all();

    // 各タスクのブロック情報を取得
    const taskBlockInfo = new Map<
      number,
      { isBlocked: boolean; blockedBy: { id: number; title: string; status: string }[] }
    >();

    for (const task of tasks) {
      const blockedByDeps = db
        .select()
        .from(schema.taskDependencies)
        .where(
          and(
            eq(schema.taskDependencies.taskId, task.id),
            eq(schema.taskDependencies.dependencyType, "blocks"),
          ),
        )
        .all();

      const blockers: { id: number; title: string; status: string }[] = [];
      for (const dep of blockedByDeps) {
        const blockerTask = db
          .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
          .from(schema.tasks)
          .where(eq(schema.tasks.id, dep.dependsOnTaskId))
          .get();

        if (blockerTask && blockerTask.status !== "completed") {
          blockers.push(blockerTask);
        }
      }

      taskBlockInfo.set(task.id, {
        isBlocked: blockers.length > 0,
        blockedBy: blockers,
      });
    }

    // タスクをブロック状態でソート (ブロックされていないタスクを先に)
    const sortedTasks = [...tasks].sort((a, b) => {
      const aBlocked = taskBlockInfo.get(a.id)?.isBlocked ?? false;
      const bBlocked = taskBlockInfo.get(b.id)?.isBlocked ?? false;
      if (aBlocked !== bBlocked) {
        return aBlocked ? 1 : -1;
      }
      // 同じブロック状態なら優先度で比較
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
      return aPriority - bPriority;
    });

    // ベースURL取得
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Markdown形式で出力
    const lines: string[] = [];
    lines.push("# 未処理タスク一覧");
    lines.push("");

    if (sortedTasks.length === 0) {
      lines.push("現在処理すべきタスクはありません。");
      return c.text(lines.join("\n"));
    }

    const blockedCount = Array.from(taskBlockInfo.values()).filter((info) => info.isBlocked).length;
    const availableCount = sortedTasks.length - blockedCount;

    lines.push(`${sortedTasks.length} 件のタスクがあります。`);
    if (blockedCount > 0) {
      lines.push(`(${availableCount} 件が着手可能、${blockedCount} 件がブロック中)`);
    }
    lines.push("");

    for (const task of sortedTasks) {
      const blockInfo = taskBlockInfo.get(task.id);
      const blockedStatus = blockInfo?.isBlocked ? " [BLOCKED]" : "";

      lines.push(`## Task #${task.id}: ${task.title}${blockedStatus}`);

      if (blockInfo?.isBlocked && blockInfo.blockedBy.length > 0) {
        lines.push(
          `ブロッカー: ${blockInfo.blockedBy.map((b) => `#${b.id} ${b.title}`).join(", ")}`,
        );
      }

      if (task.priority) {
        lines.push(`優先度: ${task.priority}`);
      }
      if (task.description) {
        lines.push(`説明: ${task.description}`);
      }
      if (task.dueDate) {
        lines.push(`期限: ${task.dueDate}`);
      }
      lines.push("");
      lines.push(buildTaskActionCommands(baseUrl, task.id, "compact"));
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return c.text(lines.join("\n"));
  });

  /**
   * GET /api/tasks/stats
   *
   * タスクの統計情報を返す
   */
  router.get("/stats", (c) => {
    const date = c.req.query("date");

    let query = db.select().from(schema.tasks);

    if (date) {
      query = query.where(eq(schema.tasks.date, date)) as typeof query;
    }

    const tasks = query.all();

    const stats = {
      total: tasks.length,
      pending: 0,
      accepted: 0,
      rejected: 0,
      in_progress: 0,
      paused: 0,
      completed: 0,
    };

    for (const task of tasks) {
      const taskStatus = task.status as keyof typeof stats;
      if (taskStatus in stats && taskStatus !== "total") {
        stats[taskStatus]++;
      }
    }

    return c.json(stats);
  });

  /**
   * GET /api/tasks/:id
   */
  router.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json(task);
  });

  /**
   * GET /api/tasks/:id/dependencies
   *
   * タスクの依存関係を取得
   * - blockedBy: このタスクをブロックしているタスク (先行タスク)
   * - blocks: このタスクがブロックしているタスク (後続タスク)
   */
  router.get("/:id/dependencies", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // このタスクをブロックしているタスク (taskId = id の依存関係)
    const blockedByDeps = db
      .select()
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, id))
      .all();

    const blockedBy = blockedByDeps.map((dep) => {
      const dependsOnTask = db
        .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, dep.dependsOnTaskId))
        .get();

      return {
        ...dep,
        dependsOnTask: dependsOnTask ?? undefined,
      };
    });

    // このタスクがブロックしているタスク (dependsOnTaskId = id の依存関係)
    const blocksDeps = db
      .select()
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.dependsOnTaskId, id))
      .all();

    const blocks = blocksDeps.map((dep) => {
      const blockedTask = db
        .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, dep.taskId))
        .get();

      return {
        ...dep,
        blockedTask: blockedTask ?? undefined,
      };
    });

    return c.json({ blockedBy, blocks });
  });

  /**
   * POST /api/tasks/:id/dependencies
   *
   * 手動で依存関係を追加
   * Body: { dependsOnTaskId: number, dependencyType?: "blocks" | "related", reason?: string }
   */
  router.post("/:id/dependencies", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{
      dependsOnTaskId: number;
      dependencyType?: "blocks" | "related";
      reason?: string;
    }>();

    if (!body.dependsOnTaskId) {
      return c.json({ error: "dependsOnTaskId is required" }, 400);
    }

    // タスクの存在確認
    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const dependsOnTask = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, body.dependsOnTaskId))
      .get();
    if (!dependsOnTask) {
      return c.json({ error: "Depends on task not found" }, 404);
    }

    // 自己参照チェック
    if (id === body.dependsOnTaskId) {
      return c.json({ error: "Task cannot depend on itself" }, 400);
    }

    // 既存の依存関係チェック
    const existing = db
      .select()
      .from(schema.taskDependencies)
      .where(
        and(
          eq(schema.taskDependencies.taskId, id),
          eq(schema.taskDependencies.dependsOnTaskId, body.dependsOnTaskId),
        ),
      )
      .get();

    if (existing) {
      return c.json({ error: "Dependency already exists" }, 409);
    }

    const dependency = db
      .insert(schema.taskDependencies)
      .values({
        taskId: id,
        dependsOnTaskId: body.dependsOnTaskId,
        dependencyType: body.dependencyType ?? "blocks",
        reason: body.reason ?? null,
        sourceType: "manual",
      })
      .returning()
      .get();

    return c.json(dependency, 201);
  });

  /**
   * DELETE /api/tasks/dependencies/:depId
   *
   * 依存関係を削除
   */
  router.delete("/dependencies/:depId", (c) => {
    const depId = Number(c.req.param("depId"));
    if (Number.isNaN(depId)) {
      return c.json({ error: "Invalid depId" }, 400);
    }

    const existing = db
      .select()
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.id, depId))
      .get();

    if (!existing) {
      return c.json({ error: "Dependency not found" }, 404);
    }

    db.delete(schema.taskDependencies).where(eq(schema.taskDependencies.id, depId)).run();

    return c.json({ deleted: true });
  });

  /**
   * GET /api/tasks/:id/ai-text
   *
   * AIに渡すためのテキストを返す
   * - タイトルと詳細をMarkdown形式で
   * - 完了用のAPIコールバックURLを含む
   */
  router.get("/:id/ai-text", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // ベースURL取得 (リクエストから)
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    // AIに渡すテキストを構築
    let text = `## ${task.title}`;
    if (task.description) {
      text += `\n\n${task.description}`;
    }
    text += "\n\n";
    text += buildTaskActionCommands(baseUrl, task.id, "detailed");

    return c.text(text);
  });

  /**
   * POST /api/tasks/:id/complete
   *
   * タスクを完了にする (シンプルなエンドポイント)
   */
  router.post("/:id/complete", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const now = new Date().toISOString();
    const result = db
      .update(schema.tasks)
      .set({
        status: "completed",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, id))
      .returning()
      .get();

    return c.json({ message: "Task completed", task: result });
  });

  /**
   * POST /api/tasks/:id/create-issue
   *
   * タスクから GitHub Issue を作成する
   * - タスクに紐づくプロジェクトの githubOwner/githubRepo を使用
   * - 子タスクがある場合はチェックリストとして本文に含める
   * - priority と workType はラベルとして追加
   */
  router.post("/:id/create-issue", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<CreateGitHubIssueRequest>().catch(() => ({}));

    // タスク取得
    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // 既に Issue が作成されている場合はエラー
    if (task.githubIssueNumber) {
      return c.json(
        {
          error: `Issue already created: #${task.githubIssueNumber}`,
          issueUrl: task.githubIssueUrl,
        },
        400,
      );
    }

    // プロジェクトから GitHub owner/repo を取得
    let owner: string | undefined = body.owner;
    let repo: string | undefined = body.repo;

    if (!owner || !repo) {
      if (!task.projectId) {
        return c.json(
          { error: "Task has no project. Please assign a project with GitHub repo settings." },
          400,
        );
      }

      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId))
        .get();

      if (!project) {
        return c.json({ error: "Project not found" }, 404);
      }

      if (!project.githubOwner || !project.githubRepo) {
        return c.json(
          { error: `Project "${project.name}" has no GitHub repository configured.` },
          400,
        );
      }

      owner = project.githubOwner;
      repo = project.githubRepo;
    }

    // Issue 本文を構築
    let issueBody = "";

    // 説明
    if (task.description) {
      issueBody += task.description;
      issueBody += "\n\n";
    }

    // 期限
    if (task.dueDate) {
      issueBody += `**期限**: ${task.dueDate}\n\n`;
    }

    // 子タスクをチェックリストとして追加
    const childTasks = getChildTasks(db, id);
    if (childTasks.length > 0) {
      issueBody += "## 子タスク\n";
      for (const child of childTasks) {
        const checked = child.status === "completed" ? "x" : " ";
        issueBody += `- [${checked}] ${child.title}\n`;
      }
      issueBody += "\n";
    }

    // タスク情報リンク
    issueBody += "---\n";
    issueBody += `*このIssueは ADAS タスク #${task.id} から作成されました*\n`;

    // ラベルを構築
    const labels: string[] = [];
    if (task.priority) {
      labels.push(`priority-${task.priority}`);
    }
    if (task.workType) {
      labels.push(`work-${task.workType}`);
    }

    try {
      // Issue 作成
      const result = await createIssue({
        owner,
        repo,
        title: task.title,
        body: issueBody.trim() || undefined,
        labels: labels.length > 0 ? labels : undefined,
      });

      const now = new Date().toISOString();
      const todayDate = getTodayDateString();

      // タスクレコードを更新
      const updatedTask = db
        .update(schema.tasks)
        .set({
          githubIssueNumber: result.number,
          githubIssueUrl: result.url,
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, id))
        .returning()
        .get();

      // github_items テーブルにも記録 (双方向同期のため)
      db.insert(schema.githubItems)
        .values({
          date: todayDate,
          itemType: "issue",
          repoOwner: owner,
          repoName: repo,
          number: result.number,
          title: result.title,
          state: "open",
          url: result.url,
          body: issueBody.trim() || null,
          labels: labels.length > 0 ? JSON.stringify(labels) : null,
          projectId: task.projectId,
          githubCreatedAt: now,
          githubUpdatedAt: now,
        })
        .run();

      consola.success(`Created GitHub Issue #${result.number} for task #${id}`);

      const response: CreateGitHubIssueResponse = {
        issueNumber: result.number,
        issueUrl: result.url,
        task: updatedTask as Task,
      };

      return c.json(response, 201);
    } catch (err) {
      consola.error("Failed to create GitHub Issue:", err);
      return c.json(
        {
          error: `Failed to create GitHub Issue: ${err instanceof Error ? err.message : String(err)}`,
        },
        500,
      );
    }
  });

  /**
   * PATCH /api/tasks/batch
   *
   * 一括更新 (ステータス、プロジェクト、優先度等)
   * Body: { ids: number[], status?: TaskStatus, projectId?: number | null, priority?: "high" | "medium" | "low" | null, reason?: string }
   */
  router.patch("/batch", async (c) => {
    const body = await c.req.json<{
      ids: number[];
      status?: TaskStatus;
      projectId?: number | null;
      priority?: "high" | "medium" | "low" | null;
      reason?: string;
    }>();

    if (!body.ids || body.ids.length === 0) {
      return c.json({ error: "ids is required" }, 400);
    }

    // いずれも指定がない場合はエラー
    if (body.status === undefined && body.projectId === undefined && body.priority === undefined) {
      return c.json({ error: "status, projectId, or priority is required" }, 400);
    }

    const now = new Date().toISOString();
    const updates: TaskUpdates = {
      updatedAt: now,
    };

    // projectId の更新
    if (body.projectId !== undefined) {
      updates.projectId = body.projectId;
    }

    // priority の更新
    if (body.priority !== undefined) {
      updates.priority = body.priority;
    }

    // status の更新
    if (body.status) {
      updates.status = body.status;

      if (body.status === "accepted") {
        updates.acceptedAt = now;
      } else if (body.status === "rejected") {
        updates.rejectedAt = now;
        if (body.reason) {
          updates.rejectReason = body.reason;
        }
      } else if (body.status === "in_progress") {
        updates.startedAt = now;
      } else if (body.status === "paused") {
        updates.pausedAt = now;
        if (body.reason) {
          updates.pauseReason = body.reason;
        }
      } else if (body.status === "completed") {
        updates.completedAt = now;
      }
    }

    const results = [];
    for (const id of body.ids) {
      const result = db
        .update(schema.tasks)
        .set(updates)
        .where(eq(schema.tasks.id, id))
        .returning()
        .get();
      if (result) {
        results.push(result);
      }
    }

    return c.json({
      updated: results.length,
      tasks: results,
    });
  });

  /**
   * PATCH /api/tasks/:id
   *
   * タスクのステータス更新
   * 修正して承認する場合は title/description を渡すと originalTitle/originalDescription に元の値を保存
   */
  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{
      status?: TaskStatus;
      priority?: "high" | "medium" | "low";
      workType?: WorkType | null;
      dueDate?: string | null;
      rejectReason?: string;
      pauseReason?: string;
      title?: string;
      description?: string;
      projectId?: number | null;
    }>();

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const now = new Date().toISOString();
    const updates: TaskUpdates = {
      updatedAt: now,
    };

    if (body.status) {
      updates.status = body.status;
      if (body.status === "accepted") {
        updates.acceptedAt = now;

        // profile-suggestion の場合、プロフィールを更新
        if (existing.sourceType === "profile-suggestion" && existing.profileSuggestionId) {
          await applyProfileSuggestion(db, existing.profileSuggestionId, now);
        }

        // vocabulary の場合、vocabulary テーブルに追加
        if (existing.sourceType === "vocabulary" && existing.vocabularySuggestionId) {
          await applyVocabularySuggestion(db, existing.vocabularySuggestionId, now);
        }

        // prompt-improvement の場合、プロンプトファイルを更新
        if (existing.sourceType === "prompt-improvement" && existing.promptImprovementId) {
          await applyPromptImprovement(db, existing.promptImprovementId, now);
        }

        // project-suggestion の場合、プロジェクトを作成
        if (existing.sourceType === "project-suggestion" && existing.projectSuggestionId) {
          await applyProjectSuggestion(db, existing.projectSuggestionId, now);
        }

        // 承認のみタスクは自動的に完了にする
        if (isApprovalOnlyTask(existing.sourceType)) {
          updates.status = "completed";
          updates.completedAt = now;
        }
      } else if (body.status === "rejected") {
        updates.rejectedAt = now;
        if (body.rejectReason) {
          updates.rejectReason = body.rejectReason;
        }

        // profile-suggestion の場合、提案も却下
        if (existing.sourceType === "profile-suggestion" && existing.profileSuggestionId) {
          db.update(schema.profileSuggestions)
            .set({ status: "rejected", rejectedAt: now })
            .where(eq(schema.profileSuggestions.id, existing.profileSuggestionId))
            .run();
        }

        // vocabulary の場合、提案も却下
        if (existing.sourceType === "vocabulary" && existing.vocabularySuggestionId) {
          db.update(schema.vocabularySuggestions)
            .set({ status: "rejected", rejectedAt: now })
            .where(eq(schema.vocabularySuggestions.id, existing.vocabularySuggestionId))
            .run();
        }

        // prompt-improvement の場合、提案も却下
        if (existing.sourceType === "prompt-improvement" && existing.promptImprovementId) {
          db.update(schema.promptImprovements)
            .set({ status: "rejected", rejectedAt: now })
            .where(eq(schema.promptImprovements.id, existing.promptImprovementId))
            .run();
        }

        // project-suggestion の場合、提案も却下
        if (existing.sourceType === "project-suggestion" && existing.projectSuggestionId) {
          db.update(schema.projectSuggestions)
            .set({ status: "rejected", rejectedAt: now })
            .where(eq(schema.projectSuggestions.id, existing.projectSuggestionId))
            .run();
        }
      } else if (body.status === "in_progress") {
        updates.startedAt = now;
      } else if (body.status === "paused") {
        updates.pausedAt = now;
        if (body.pauseReason) {
          updates.pauseReason = body.pauseReason;
        }
      } else if (body.status === "completed") {
        updates.completedAt = now;
      }
    }

    if (body.priority !== undefined) {
      updates.priority = body.priority;
    }

    if (body.workType !== undefined) {
      updates.workType = body.workType;
    }

    if (body.dueDate !== undefined) {
      updates.dueDate = body.dueDate;
    }

    // 修正して承認: title/description が変更された場合、元の値を保存
    if (body.title !== undefined && body.title !== existing.title) {
      updates.originalTitle = existing.title;
      updates.title = body.title;
    }
    if (body.description !== undefined && body.description !== existing.description) {
      updates.originalDescription = existing.description;
      updates.description = body.description;
    }

    // プロジェクト紐付け更新
    if (body.projectId !== undefined) {
      updates.projectId = body.projectId;
    }

    const result = db
      .update(schema.tasks)
      .set(updates)
      .where(eq(schema.tasks.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/tasks/extract
   *
   * Slack メッセージからタスクを抽出
   * Body: { date?: string, messageIds?: number[] }
   */
  router.post("/extract", async (c) => {
    const body = await c.req.json<{
      date?: string;
      messageIds?: number[];
    }>();

    const date = body.date ?? getTodayDateString();

    // 対象メッセージを取得
    let messages: SlackMessage[];
    if (body.messageIds && body.messageIds.length > 0) {
      messages = db
        .select()
        .from(schema.slackMessages)
        .where(inArray(schema.slackMessages.id, body.messageIds))
        .all();
    } else {
      // 未処理のメンション・DM を取得
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
      return c.json({ extracted: 0, tasks: [] });
    }

    // 既に抽出済みのメッセージを除外 (抽出ログでチェック)
    const targetMessages = messages.filter(
      (m) => !hasExtractionLog(db, "task", "slack", String(m.id)),
    );

    if (targetMessages.length === 0) {
      return c.json({ extracted: 0, tasks: [], message: "All messages already processed" });
    }

    // Few-shot examples を構築 (過去の承認/却下履歴から)
    const fewShotExamples = buildFewShotExamples(db);

    // vocabulary セクションを取得
    const vocabularySection = buildVocabularySection(db);

    // 過去の処理済みタスク (類似チェック用)
    const processedTasksSection = buildProcessedTasksSection(db);

    // プロンプト読み込み
    const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

    const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];
    const tasksWithDeps: TaskWithDependencies[] = [];

    // 1パス目: タスク保存
    for (const message of targetMessages) {
      const userPrompt = buildUserPrompt(
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
                workType: extractedTask.workType ?? null,
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

            // 依存関係があれば記録
            if (extractedTask.dependencies && extractedTask.dependencies.length > 0) {
              tasksWithDeps.push({
                task,
                extractedDependencies: extractedTask.dependencies,
              });
            }
          }
        }
        // Record extraction log (even if 0 tasks extracted)
        recordExtractionLog(db, "task", "slack", String(message.id), extractedCount);
      } catch (error) {
        console.error(`Failed to extract tasks from message ${message.id}:`, error);
      }
    }

    // 2パス目: 依存関係保存
    if (tasksWithDeps.length > 0) {
      saveDependencies(db, tasksWithDeps);
    }

    return c.json({
      extracted: createdTasks.length,
      tasks: createdTasks,
    });
  });

  /**
   * POST /api/tasks/extract/async
   *
   * Slack メッセージからタスクを抽出 (非同期版)
   * ジョブをキューに登録して即座にレスポンスを返す
   * Body: { date?: string, messageIds?: number[] }
   */
  router.post("/extract/async", async (c) => {
    const body = await c.req.json<{
      date?: string;
      messageIds?: number[];
    }>();

    const jobId = enqueueJob(db, "task-extract-slack", {
      date: body.date,
      messageIds: body.messageIds,
    });

    return c.json({ jobId, status: "pending" }, 202);
  });

  /**
   * POST /api/tasks/extract-github
   *
   * GitHub Items (Issues/PRs) からタスクを抽出
   * - レビュー依頼された PR
   * - 自分がアサインされた Issue
   * Body: { date?: string }
   */
  router.post("/extract-github", async (c) => {
    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();
    const config = loadConfig();
    const githubUsername = config.github.username;

    if (!githubUsername) {
      return c.json({
        extracted: 0,
        tasks: [],
        warning: "GitHub username not configured. Set github.username in ~/.adas/config.json",
      });
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
      return c.json({ extracted: 0, tasks: [] });
    }

    // 既存のタスクと重複チェック (タイトルで判定)
    const existingTaskTitles = db
      .select({ title: schema.tasks.title })
      .from(schema.tasks)
      .where(eq(schema.tasks.date, date))
      .all()
      .map((t) => t.title);

    const createdTasks = [];

    for (const item of allItems) {
      // プロジェクト紐付け (repoOwner/repoName から)
      const projectId = findOrCreateProjectByGitHub(db, item.repoOwner, item.repoName);

      // PR のレビュー依頼
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
              workType: "review",
              confidence: 1.0,
              dueDate: null,
            })
            .returning()
            .get();
          createdTasks.push(task);
          existingTaskTitles.push(title);
        }
      }

      // アサインされた Issue (既にフィルタ済み)
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
              workType: "create",
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

    return c.json({
      extracted: createdTasks.length,
      tasks: createdTasks,
    });
  });

  /**
   * POST /api/tasks/extract-github/async
   *
   * GitHub Items からタスクを抽出 (非同期版)
   * Body: { date?: string }
   */
  router.post("/extract-github/async", async (c) => {
    const body = await c.req.json<{ date?: string }>();

    const jobId = enqueueJob(db, "task-extract-github", {
      date: body.date,
    });

    return c.json({ jobId, status: "pending" }, 202);
  });

  /**
   * POST /api/tasks/extract-github-comments
   *
   * GitHub Comments からタスクを抽出
   * - レビューコメントで対応が必要なもの
   * - Issue コメントで質問や依頼があるもの
   * Body: { date?: string }
   */
  router.post("/extract-github-comments", async (c) => {
    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();
    const config = loadConfig();
    const githubUsername = config.github.username;

    if (!githubUsername) {
      return c.json({
        extracted: 0,
        tasks: [],
        warning: "GitHub username not configured. Set github.username in ~/.adas/config.json",
      });
    }

    // GitHub コメントを取得 (自分以外が書いたコメントのみ)
    const allComments = db
      .select()
      .from(schema.githubComments)
      .where(eq(schema.githubComments.date, date))
      .all();

    // 自分宛てのコメントをフィルタ:
    // 1. 自分が書いたコメントは除外
    // 2. コメント内で @username がメンションされている
    const mentionPattern = new RegExp(`@${githubUsername}\\b`, "i");
    const comments = allComments.filter(
      (c) => c.authorLogin !== githubUsername && mentionPattern.test(c.body),
    );

    if (comments.length === 0) {
      return c.json({ extracted: 0, tasks: [] });
    }

    // 既に抽出済みのコメントを除外 (抽出ログでチェック)
    const targetComments = comments.filter(
      (c) => !hasExtractionLog(db, "task", "github-comment", String(c.id)),
    );

    if (targetComments.length === 0) {
      return c.json({ extracted: 0, tasks: [], message: "All comments already processed" });
    }

    // Few-shot examples を構築
    const fewShotExamples = buildFewShotExamples(db);

    // vocabulary セクションを取得
    const vocabularySection = buildVocabularySection(db);

    // 過去の処理済みタスク (類似チェック用)
    const processedTasksSection = buildProcessedTasksSection(db);

    // プロンプト読み込み
    const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

    const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];
    const tasksWithDeps: TaskWithDependencies[] = [];

    // 1パス目: タスク保存
    for (const comment of targetComments) {
      // プロジェクト紐付け (repoOwner/repoName から)
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
                workType: extractedTask.workType ?? null,
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

            // 依存関係があれば記録
            if (extractedTask.dependencies && extractedTask.dependencies.length > 0) {
              tasksWithDeps.push({
                task,
                extractedDependencies: extractedTask.dependencies,
              });
            }
          }
        }
        // Record extraction log (even if 0 tasks extracted)
        recordExtractionLog(db, "task", "github-comment", String(comment.id), extractedCount);
      } catch (error) {
        console.error(`Failed to extract tasks from comment ${comment.id}:`, error);
      }
    }

    // 2パス目: 依存関係保存
    if (tasksWithDeps.length > 0) {
      saveDependencies(db, tasksWithDeps);
    }

    return c.json({
      extracted: createdTasks.length,
      tasks: createdTasks,
    });
  });

  /**
   * POST /api/tasks/extract-github-comments/async
   *
   * GitHub Comments からタスクを抽出 (非同期版)
   * Body: { date?: string }
   */
  router.post("/extract-github-comments/async", async (c) => {
    const body = await c.req.json<{ date?: string }>();

    const jobId = enqueueJob(db, "task-extract-github-comment", {
      date: body.date,
    });

    return c.json({ jobId, status: "pending" }, 202);
  });

  /**
   * POST /api/tasks/extract-memos
   *
   * メモからタスクを抽出
   * Body: { date?: string, memoIds?: number[] }
   */
  router.post("/extract-memos", async (c) => {
    const body = await c.req.json<{ date?: string; memoIds?: number[] }>();
    const date = body.date ?? getTodayDateString();

    // メモを取得 (memoIds が指定されていればそれを優先)
    const memos = body.memoIds?.length
      ? db.select().from(schema.memos).where(inArray(schema.memos.id, body.memoIds)).all()
      : db.select().from(schema.memos).where(eq(schema.memos.date, date)).all();

    if (memos.length === 0) {
      return c.json({ extracted: 0, tasks: [] });
    }

    // 既に抽出済みのメモを除外 (抽出ログでチェック)
    const targetMemos = memos.filter((m) => !hasExtractionLog(db, "task", "memo", String(m.id)));

    if (targetMemos.length === 0) {
      return c.json({ extracted: 0, tasks: [], message: "All memos already processed" });
    }

    // Few-shot examples を構築
    const fewShotExamples = buildFewShotExamples(db);

    // vocabulary セクションを取得
    const vocabularySection = buildVocabularySection(db);

    // 過去の処理済みタスク (類似チェック用)
    const processedTasksSection = buildProcessedTasksSection(db);

    // プロンプト読み込み
    const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

    const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];
    const tasksWithDeps: TaskWithDependencies[] = [];

    // 1パス目: タスク保存
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
                workType: extractedTask.workType ?? null,
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

            // 依存関係があれば記録
            if (extractedTask.dependencies && extractedTask.dependencies.length > 0) {
              tasksWithDeps.push({
                task,
                extractedDependencies: extractedTask.dependencies,
              });
            }
          }
        }
        // Record extraction log (even if 0 tasks extracted)
        recordExtractionLog(db, "task", "memo", String(memo.id), extractedCount);
      } catch (error) {
        console.error(`Failed to extract tasks from memo ${memo.id}:`, error);
      }
    }

    // 2パス目: 依存関係保存
    if (tasksWithDeps.length > 0) {
      saveDependencies(db, tasksWithDeps);
    }

    return c.json({
      extracted: createdTasks.length,
      tasks: createdTasks,
    });
  });

  /**
   * POST /api/tasks/extract-memos/async
   *
   * メモからタスクを抽出 (非同期版)
   * Body: { date?: string }
   */
  router.post("/extract-memos/async", async (c) => {
    const body = await c.req.json<{ date?: string }>();

    const jobId = enqueueJob(db, "task-extract-memo", {
      date: body.date,
    });

    return c.json({ jobId, status: "pending" }, 202);
  });

  /**
   * POST /api/tasks/:id/start
   *
   * タスクを実行中にする
   */
  router.post("/:id/start", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const now = new Date().toISOString();
    const result = db
      .update(schema.tasks)
      .set({
        status: "in_progress",
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/tasks/:id/pause
   *
   * タスクを中断する
   * Body: { reason?: string }
   */
  router.post("/:id/pause", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const now = new Date().toISOString();
    const result = db
      .update(schema.tasks)
      .set({
        status: "paused",
        pausedAt: now,
        pauseReason: body.reason ?? null,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/tasks/:id/accept
   *
   * タスクを承認
   * 承認のみタスク (prompt-improvement, profile-suggestion, vocabulary) は自動的に完了になる
   */
  router.post("/:id/accept", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const now = new Date().toISOString();

    // 承認のみタスクは自動的に完了にする
    if (isApprovalOnlyTask(existing.sourceType)) {
      // prompt-improvement の場合、プロンプトファイルを更新
      if (existing.sourceType === "prompt-improvement" && existing.promptImprovementId) {
        await applyPromptImprovement(db, existing.promptImprovementId, now);
      }

      // profile-suggestion の場合、プロフィールを更新
      if (existing.sourceType === "profile-suggestion" && existing.profileSuggestionId) {
        await applyProfileSuggestion(db, existing.profileSuggestionId, now);
      }

      // vocabulary の場合、vocabulary テーブルに追加
      if (existing.sourceType === "vocabulary" && existing.vocabularySuggestionId) {
        await applyVocabularySuggestion(db, existing.vocabularySuggestionId, now);
      }

      // merge の場合、統合処理を実行
      if (existing.sourceType === "merge" && existing.mergeSourceTaskIds) {
        await executeMerge(db, existing, now);
      }

      // project-suggestion の場合、プロジェクトを作成
      if (existing.sourceType === "project-suggestion" && existing.projectSuggestionId) {
        await applyProjectSuggestion(db, existing.projectSuggestionId, now);
      }

      const result = db
        .update(schema.tasks)
        .set({
          status: "completed",
          acceptedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, id))
        .returning()
        .get();

      return c.json(result);
    }

    // 通常タスクは承認済みにする
    const result = db
      .update(schema.tasks)
      .set({
        status: "accepted",
        acceptedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/tasks/:id/reject
   *
   * タスクを却下
   * Body: { reason?: string }
   */
  router.post("/:id/reject", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const now = new Date().toISOString();

    // 関連テーブルの却下処理
    if (existing.sourceType === "prompt-improvement" && existing.promptImprovementId) {
      db.update(schema.promptImprovements)
        .set({ status: "rejected", rejectedAt: now })
        .where(eq(schema.promptImprovements.id, existing.promptImprovementId))
        .run();
    }
    if (existing.sourceType === "profile-suggestion" && existing.profileSuggestionId) {
      db.update(schema.profileSuggestions)
        .set({ status: "rejected", rejectedAt: now })
        .where(eq(schema.profileSuggestions.id, existing.profileSuggestionId))
        .run();
    }
    if (existing.sourceType === "vocabulary" && existing.vocabularySuggestionId) {
      db.update(schema.vocabularySuggestions)
        .set({ status: "rejected", rejectedAt: now })
        .where(eq(schema.vocabularySuggestions.id, existing.vocabularySuggestionId))
        .run();
    }
    if (existing.sourceType === "project-suggestion" && existing.projectSuggestionId) {
      db.update(schema.projectSuggestions)
        .set({ status: "rejected", rejectedAt: now })
        .where(eq(schema.projectSuggestions.id, existing.projectSuggestionId))
        .run();
    }

    const result = db
      .update(schema.tasks)
      .set({
        status: "rejected",
        rejectedAt: now,
        rejectReason: body.reason ?? null,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * DELETE /api/tasks/:id
   */
  router.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    db.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();

    return c.json({ deleted: true });
  });

  /**
   * POST /api/tasks/:id/elaborate
   *
   * タスクを非同期で AI 詳細化 (AI Job キューに登録)
   * Body: ElaborateTaskRequest
   * Returns: { jobId, status: "pending" }
   */
  router.post("/:id/elaborate", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const body = await c.req.json<ElaborateTaskRequest>().catch((): ElaborateTaskRequest => ({}));

    // 既に詳細化中の場合はエラー
    if (task.elaborationStatus === "pending") {
      return c.json({ error: "Elaboration already in progress" }, 400);
    }

    // タスクの elaborationStatus を pending に設定
    db.update(schema.tasks)
      .set({
        elaborationStatus: "pending",
        pendingElaboration: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, id))
      .run();

    // AI Job キューに登録
    const jobId = enqueueJob(db, "task-elaborate", {
      taskId: id,
      userInstruction: body.userInstruction,
      level: body.level,
    });

    consola.info(`[tasks/elaborate] Queued elaboration job ${jobId} for task ${id}`);

    return c.json({ jobId, status: "pending" });
  });

  /**
   * GET /api/tasks/:id/elaboration
   *
   * 詳細化状態を取得
   * Returns: ElaborationStatusResponse
   */
  router.get("/:id/elaboration", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // pending または failed 状態の場合、AI Job の状態を確認
    let jobId: number | null = null;
    let jobStatus: string | null = null;
    let errorMessage: string | null = null;

    if (task.elaborationStatus === "pending" || task.elaborationStatus === "failed") {
      // 最新の task-elaborate ジョブを取得
      const jobs = db
        .select()
        .from(schema.aiJobQueue)
        .where(eq(schema.aiJobQueue.jobType, "task-elaborate"))
        .orderBy(desc(schema.aiJobQueue.createdAt))
        .limit(10)
        .all();

      const job = jobs.find((j) => {
        const params = j.params ? JSON.parse(j.params) : {};
        return params.taskId === id;
      });

      if (job) {
        jobId = job.id;
        jobStatus = job.status;
        if (job.status === "failed" || task.elaborationStatus === "failed") {
          errorMessage = job.errorMessage;
        }
      }
    }

    // 結果をパース
    let result = null;
    if (task.elaborationStatus === "completed" && task.pendingElaboration) {
      try {
        result = JSON.parse(task.pendingElaboration);
      } catch {
        consola.warn(`[tasks/elaboration] Failed to parse pendingElaboration for task ${id}`);
      }
    }

    return c.json({
      taskId: id,
      status: task.elaborationStatus,
      jobId,
      jobStatus,
      result,
      errorMessage,
    });
  });

  /**
   * POST /api/tasks/:id/elaboration/apply
   *
   * 詳細化結果を適用 (親タスクの説明更新 + 子タスク作成)
   * Body: ApplyElaborationRequest
   * Returns: ApplyElaborationResponse
   */
  router.post("/:id/elaboration/apply", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    if (task.elaborationStatus !== "completed" || !task.pendingElaboration) {
      return c.json({ error: "No completed elaboration to apply" }, 400);
    }

    const body = await c.req
      .json<{
        updateParentDescription?: boolean;
        createChildTasks?: boolean;
        childTaskEdits?: Array<{
          stepNumber: number;
          title?: string;
          description?: string;
          include?: boolean;
        }>;
      }>()
      .catch(() => ({}));

    const updateParentDescription = body.updateParentDescription ?? true;
    const createChildTasks = body.createChildTasks ?? true;

    // 結果をパース
    let elaborationResult: {
      elaboration?: string;
      childTasks?: Array<{
        stepNumber: number;
        title: string;
        description?: string;
      }>;
    };
    try {
      elaborationResult = JSON.parse(task.pendingElaboration);
    } catch {
      return c.json({ error: "Invalid elaboration data" }, 500);
    }

    const now = new Date().toISOString();

    // 親タスクの説明を更新
    if (updateParentDescription && elaborationResult.elaboration) {
      db.update(schema.tasks)
        .set({
          description: elaborationResult.elaboration,
          elaborationStatus: "applied", // 適用済みマークを設定
          pendingElaboration: null,
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, id))
        .run();
    } else {
      // 説明を更新しない場合でも、適用済みマークを設定
      db.update(schema.tasks)
        .set({
          elaborationStatus: "applied", // 適用済みマークを設定
          pendingElaboration: null,
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, id))
        .run();
    }

    // 子タスクを作成
    const childTasks: (typeof schema.tasks.$inferSelect)[] = [];
    if (createChildTasks && elaborationResult.childTasks?.length > 0) {
      for (const childTask of elaborationResult.childTasks) {
        // 編集がある場合は適用
        const edit = body.childTaskEdits?.find((e) => e.stepNumber === childTask.stepNumber);
        if (edit?.include === false) {
          continue; // スキップ
        }

        const title = edit?.title ?? childTask.title;
        const description = edit?.description ?? childTask.description;

        const createdChild = db
          .insert(schema.tasks)
          .values({
            date: task.date,
            projectId: task.projectId,
            sourceType: task.sourceType,
            title,
            description,
            status: "pending",
            priority: task.priority,
            workType: task.workType,
            parentId: id,
            stepNumber: childTask.stepNumber,
            confidence: 1.0,
          })
          .returning()
          .get();

        childTasks.push(createdChild);
      }

      consola.info(
        `[tasks/elaboration/apply] Created ${childTasks.length} child tasks for task ${id}`,
      );
    }

    // 更新された親タスクを取得
    const updatedTask = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

    return c.json({
      parentTask: updatedTask,
      childTasks,
    });
  });

  /**
   * POST /api/tasks/:id/elaboration/discard
   *
   * 詳細化結果を破棄
   */
  router.post("/:id/elaboration/discard", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // 詳細化状態をクリア
    db.update(schema.tasks)
      .set({
        elaborationStatus: null,
        pendingElaboration: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, id))
      .run();

    consola.info(`[tasks/elaboration/discard] Discarded elaboration for task ${id}`);

    return c.json({ discarded: true });
  });

  /**
   * GET /api/tasks/:id/children
   *
   * 子タスク一覧を取得
   */
  router.get("/:id/children", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // 子タスクを stepNumber 順で取得
    const childTasks = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.parentId, id))
      .orderBy(schema.tasks.stepNumber)
      .all();

    return c.json({
      childTasks,
      total: childTasks.length,
    });
  });

  /**
   * POST /api/tasks/bulk-elaborate
   *
   * 複数タスクを非同期で一括 AI 詳細化
   * 各タスクに個別の AI Job を登録して即座に返す
   * Body: BulkElaborateTasksRequest
   * Returns: BulkElaborateStartResponse
   */
  router.post("/bulk-elaborate", async (c) => {
    const body = await c.req
      .json<BulkElaborateTasksRequest>()
      .catch((): BulkElaborateTasksRequest => ({ taskIds: [] }));

    if (!body.taskIds || body.taskIds.length === 0) {
      return c.json({ error: "taskIds is required" }, 400);
    }

    if (body.taskIds.length > 10) {
      return c.json({ error: "Maximum 10 tasks can be elaborated at once" }, 400);
    }

    // タスク情報を一括取得
    const tasks = db
      .select()
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, body.taskIds))
      .all();

    if (tasks.length === 0) {
      return c.json({ error: "No tasks found" }, 404);
    }

    const now = new Date().toISOString();
    const jobIds: number[] = [];
    const processedTaskIds: number[] = [];

    // 各タスクに対して elaborationStatus を pending に設定し、AI Job を登録
    for (const task of tasks) {
      // 既に詳細化中のタスクはスキップ
      if (task.elaborationStatus === "pending") {
        consola.info(`[tasks/bulk-elaborate] Task ${task.id} already pending, skipping`);
        continue;
      }

      // elaborationStatus を pending に設定
      db.update(schema.tasks)
        .set({
          elaborationStatus: "pending",
          pendingElaboration: null,
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, task.id))
        .run();

      // AI Job キューに登録
      const jobId = enqueueJob(db, "task-elaborate", {
        taskId: task.id,
        userInstruction: body.userInstruction,
        level: body.level,
      });

      jobIds.push(jobId);
      processedTaskIds.push(task.id);
      consola.info(`[tasks/bulk-elaborate] Queued job ${jobId} for task ${task.id}`);
    }

    const response: BulkElaborateStartResponse = {
      taskIds: processedTaskIds,
      jobIds,
      status: "pending",
      message: `${processedTaskIds.length} 件のタスクの詳細化を開始しました`,
    };

    return c.json(response);
  });

  /**
   * GET /api/tasks/bulk-elaboration-status
   *
   * 複数タスクの詳細化状態を一括取得
   * Query: taskIds (カンマ区切り)
   * Returns: BulkElaborationStatusResponse
   */
  router.get("/bulk-elaboration-status", (c) => {
    const taskIdsParam = c.req.query("taskIds");
    if (!taskIdsParam) {
      return c.json({ error: "taskIds query parameter is required" }, 400);
    }

    const taskIds = taskIdsParam
      .split(",")
      .map(Number)
      .filter((id) => !Number.isNaN(id));
    if (taskIds.length === 0) {
      return c.json({ error: "Invalid taskIds" }, 400);
    }

    // タスク情報を一括取得
    const tasks = db
      .select({
        id: schema.tasks.id,
        elaborationStatus: schema.tasks.elaborationStatus,
        pendingElaboration: schema.tasks.pendingElaboration,
      })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, taskIds))
      .all();

    // ステータスを集計
    const statuses = tasks.map((task) => ({
      taskId: task.id,
      status: task.elaborationStatus as ElaborationStatus | null,
      hasResult: !!(task.elaborationStatus === "completed" && task.pendingElaboration),
    }));

    const summary = {
      pending: tasks.filter((t) => t.elaborationStatus === "pending").length,
      completed: tasks.filter((t) => t.elaborationStatus === "completed").length,
      failed: tasks.filter((t) => t.elaborationStatus === "failed").length,
      total: tasks.length,
    };

    const allCompleted = summary.pending === 0 && summary.total > 0;

    const response: BulkElaborationStatusResponse = {
      statuses,
      summary,
      allCompleted,
    };

    return c.json(response);
  });

  /**
   * POST /api/tasks/suggest-completions
   *
   * 完了候補を提案
   * GitHub → Claude Code → Slack → Transcribe の順で評価し、早期リターン
   * Body: { date?: string }
   */
  router.post("/suggest-completions", async (c) => {
    const body = await c.req.json<{ date?: string }>().catch(() => ({ date: undefined }));

    // accepted 状態のタスクを取得
    const conditions = [eq(schema.tasks.status, "accepted")];
    if (body.date) {
      conditions.push(eq(schema.tasks.date, body.date));
    }

    const acceptedTasks = db
      .select()
      .from(schema.tasks)
      .where(and(...conditions))
      .orderBy(desc(schema.tasks.acceptedAt))
      .all();

    if (acceptedTasks.length === 0) {
      return c.json({
        suggestions: [],
        evaluated: { total: 0, github: 0, claudeCode: 0, slack: 0, transcribe: 0 },
      } satisfies SuggestCompletionsResponse);
    }

    const suggestions: TaskCompletionSuggestion[] = [];
    const evaluated = { total: 0, github: 0, claudeCode: 0, slack: 0, transcribe: 0 };

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
        const result = await checkClaudeCodeCompletion(db, task);
        if (result) {
          suggestions.push({
            taskId: task.id,
            task: task as Task,
            source: "claude-code",
            reason: result.reason,
            confidence: result.confidence,
            evidence: result.evidence,
          });
          continue; // 早期リターン
        }
      }

      // 3. Slack 評価 (AI判定)
      if (task.slackMessageId) {
        evaluated.slack++;
        const result = await checkSlackCompletion(db, task);
        if (result) {
          suggestions.push({
            taskId: task.id,
            task: task as Task,
            source: "slack",
            reason: result.reason,
            confidence: result.confidence,
            evidence: result.evidence,
          });
          continue; // 早期リターン
        }
      }

      // 4. Transcribe 評価 (AI判定)
      evaluated.transcribe++;
      const result = await checkTranscribeCompletion(db, task);
      if (result) {
        suggestions.push({
          taskId: task.id,
          task: task as Task,
          source: "transcribe",
          reason: result.reason,
          confidence: result.confidence,
          evidence: result.evidence,
        });
      }
    }

    return c.json({
      suggestions,
      evaluated,
    } satisfies SuggestCompletionsResponse);
  });

  /**
   * POST /api/tasks/detect-duplicates
   *
   * 承認済みタスク間の重複を検出
   * Body: { date?: string, projectId?: number, minSimilarity?: number }
   */
  router.post("/detect-duplicates", async (c) => {
    const body = await c.req
      .json<{
        date?: string;
        projectId?: number;
        minSimilarity?: number;
      }>()
      .catch(() => ({}) as { date?: string; projectId?: number; minSimilarity?: number });

    const minSimilarity = body.minSimilarity ?? 0.7;

    // accepted 状態のタスクを取得
    const conditions = [eq(schema.tasks.status, "accepted")];
    if (body.date) {
      conditions.push(eq(schema.tasks.date, body.date));
    }
    if (body.projectId) {
      conditions.push(eq(schema.tasks.projectId, body.projectId));
    }

    const acceptedTasks = db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        description: schema.tasks.description,
      })
      .from(schema.tasks)
      .where(and(...conditions))
      .all();

    if (acceptedTasks.length < 2) {
      return c.json({
        duplicates: [],
        evaluated: acceptedTasks.length,
      } satisfies DetectDuplicatesResponse);
    }

    // Worker で AI 判定
    const config = loadConfig();
    const workerUrl = config.worker?.url ?? "http://localhost:3100";

    try {
      const response = await fetch(`${workerUrl}/rpc/check-duplicates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: acceptedTasks,
          minSimilarity,
        }),
      });

      if (!response.ok) {
        consola.warn(`[detect-duplicates] Worker returned ${response.status}`);
        return c.json({
          duplicates: [],
          evaluated: acceptedTasks.length,
        } satisfies DetectDuplicatesResponse);
      }

      const result = (await response.json()) as CheckDuplicatesResponse;

      return c.json({
        duplicates: result.duplicates,
        evaluated: acceptedTasks.length,
      } satisfies DetectDuplicatesResponse);
    } catch (err) {
      consola.error("[detect-duplicates] Worker call failed:", err);
      return c.json({
        duplicates: [],
        evaluated: acceptedTasks.length,
        error: err instanceof Error ? err.message : "Worker error",
      });
    }
  });

  /**
   * POST /api/tasks/merge
   *
   * マージタスクを作成
   * Body: { sourceTaskIds: number[], title: string, description?: string, priority?: string, projectId?: number }
   */
  router.post("/merge", async (c) => {
    const body = await c.req.json<{
      sourceTaskIds: number[];
      title: string;
      description?: string;
      priority?: "high" | "medium" | "low";
      projectId?: number;
    }>();

    if (!body.sourceTaskIds || body.sourceTaskIds.length < 2) {
      return c.json({ error: "At least 2 sourceTaskIds are required" }, 400);
    }

    if (!body.title) {
      return c.json({ error: "title is required" }, 400);
    }

    // 統合元タスクを取得 (accepted のみ)
    const sourceTasks = db
      .select()
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.id, body.sourceTaskIds), eq(schema.tasks.status, "accepted")))
      .all();

    if (sourceTasks.length !== body.sourceTaskIds.length) {
      return c.json(
        {
          error: "Some source tasks are not found or not in accepted status",
          found: sourceTasks.length,
          requested: body.sourceTaskIds.length,
        },
        400,
      );
    }

    // プロジェクト ID を決定 (指定がなければ統合元の最初のタスクから)
    const projectId = body.projectId ?? sourceTasks[0]?.projectId ?? null;

    // 優先度を決定 (指定がなければ統合元の最高優先度)
    let priority = body.priority;
    if (!priority) {
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const highestPriority = sourceTasks.reduce(
        (acc, task) => {
          if (!task.priority) return acc;
          if (!acc) return task.priority;
          return priorityOrder[task.priority]! < priorityOrder[acc]! ? task.priority : acc;
        },
        null as "high" | "medium" | "low" | null,
      );
      priority = highestPriority ?? undefined;
    }

    const date = getTodayDateString();

    // workType は最初のソースタスクから継承
    const workType = sourceTasks.find((t) => t.workType)?.workType ?? null;

    // マージタスクを作成 (pending として)
    const mergeTask = db
      .insert(schema.tasks)
      .values({
        date,
        sourceType: "merge",
        title: body.title,
        description: body.description ?? null,
        priority: priority ?? null,
        workType,
        projectId,
        mergeSourceTaskIds: JSON.stringify(body.sourceTaskIds),
        confidence: 1.0,
      })
      .returning()
      .get();

    consola.info(
      `[tasks/merge] Created merge task #${mergeTask.id} from tasks: ${body.sourceTaskIds.join(", ")}`,
    );

    return c.json({
      mergeTask,
      sourceTasks,
    } satisfies CreateMergeTaskResponse);
  });

  /**
   * POST /api/tasks/:id/check-similarity
   *
   * 個別タスクの類似チェック
   * - 過去の完了/却下タスクとの類似性を AI で判定
   * - 類似があれば similarTo* フィールドを更新
   */
  router.post("/:id/check-similarity", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // pending/accepted のタスクのみ対象
    if (task.status !== "pending" && task.status !== "accepted") {
      return c.json({
        updated: false,
        similarTo: null,
      } satisfies CheckTaskSimilarityResponse);
    }

    const result = await checkTaskSimilarity(db, task);

    return c.json(result satisfies CheckTaskSimilarityResponse);
  });

  /**
   * POST /api/tasks/check-similarity-batch
   *
   * 一括類似チェック
   * - pending タスクに対して一括で類似チェックを実行
   */
  router.post("/check-similarity-batch", async (c) => {
    const body = await c.req.json<CheckSimilarityBatchRequest>();

    // 対象タスクを取得
    const conditions = [
      eq(schema.tasks.status, "pending"),
      isNull(schema.tasks.parentId), // 親タスクのみ
    ];

    if (body.date) {
      conditions.push(eq(schema.tasks.date, body.date));
    }

    if (body.projectId) {
      conditions.push(eq(schema.tasks.projectId, body.projectId));
    }

    let tasks: Task[];
    if (body.taskIds && body.taskIds.length > 0) {
      // 指定された ID のタスクのみ
      tasks = db
        .select()
        .from(schema.tasks)
        .where(and(inArray(schema.tasks.id, body.taskIds), eq(schema.tasks.status, "pending")))
        .all();
    } else {
      tasks = db
        .select()
        .from(schema.tasks)
        .where(and(...conditions))
        .orderBy(desc(schema.tasks.extractedAt))
        .limit(50) // 一度に処理するタスク数を制限
        .all();
    }

    const results: SimilarityCheckResult[] = [];
    let updated = 0;

    for (const task of tasks) {
      const result = await checkTaskSimilarity(db, task);
      results.push({
        taskId: task.id,
        updated: result.updated,
        similarToTitle: result.similarTo?.title ?? null,
        similarToStatus: result.similarTo?.status ?? null,
        similarToReason: result.similarTo?.reason ?? null,
      });
      if (result.updated) {
        updated++;
      }
    }

    consola.info(
      `[tasks/check-similarity-batch] Checked ${tasks.length} tasks, ${updated} updated`,
    );

    return c.json({
      checked: tasks.length,
      updated,
      results,
    } satisfies CheckSimilarityBatchResponse);
  });

  /**
   * POST /api/tasks/extract-logs
   *
   * サーバーログから ERROR/WARN レベルのエントリを分析し、対応タスクを抽出
   * Body: ExtractTasksFromLogsRequest
   */
  router.post("/extract-logs", async (c) => {
    const body = await c.req.json<{
      source: "serve" | "worker";
      date?: string;
      levels?: string[];
      limit?: number;
    }>();

    if (!body.source || (body.source !== "serve" && body.source !== "worker")) {
      return c.json({ error: "source must be 'serve' or 'worker'" }, 400);
    }

    const date = body.date ?? getTodayDateString();
    const levels = body.levels ?? ["ERROR", "WARN"];
    const limit = Math.min(body.limit ?? 50, 50);

    // ログファイルを読み込み
    const allEntries = readLogFile(body.source, date, { limit: 1000 }); // 一旦多めに読む

    // レベルでフィルタ
    const filteredEntries = allEntries.filter((entry) => levels.includes(entry.level));

    if (filteredEntries.length === 0) {
      return c.json({
        extracted: 0,
        processed: 0,
        skipped: 0,
        grouped: 0,
        tasks: [],
        message: `No ${levels.join("/")} entries found in ${body.source} logs for ${date}`,
      });
    }

    // 各エントリに一意な ID を付与
    const entriesWithIds = filteredEntries.map((entry) => ({
      ...entry,
      entryId: generateLogEntryId(body.source, date, entry),
    }));

    // 処理済みエントリを除外
    const unprocessedEntries = entriesWithIds.filter(
      (entry) => !hasExtractionLog(db, "task", "server-log", entry.entryId),
    );

    const skipped = entriesWithIds.length - unprocessedEntries.length;

    if (unprocessedEntries.length === 0) {
      return c.json({
        extracted: 0,
        processed: 0,
        skipped,
        grouped: 0,
        tasks: [],
        message: "All log entries already processed",
      });
    }

    // 上限適用
    const targetEntries = unprocessedEntries.slice(0, limit);

    // 類似エラーをグループ化
    const groupedEntries = groupSimilarLogEntries(targetEntries);

    // プロンプト読み込み
    const systemPrompt = readFileSync(getPromptFilePath("task-extract-logs"), "utf-8");

    // ユーザープロンプトを構築
    const userPrompt = buildLogExtractionPrompt(groupedEntries, date, body.source);

    try {
      const response = await runClaude(userPrompt, {
        model: "haiku",
        systemPrompt,
        disableTools: true,
      });

      const parsed = parseLogExtractResult(response);

      const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];

      for (const extractedTask of parsed.tasks) {
        const task = db
          .insert(schema.tasks)
          .values({
            date,
            sourceType: "server-log",
            title: extractedTask.title,
            description: extractedTask.description ?? null,
            priority: extractedTask.priority ?? null,
            workType: extractedTask.workType ?? null,
            confidence: extractedTask.confidence ?? null,
          })
          .returning()
          .get();

        createdTasks.push(task);

        // 関連するログエントリを処理済みとして記録
        for (const entryId of extractedTask.logEntryIds ?? []) {
          recordExtractionLog(db, "task", "server-log", entryId, 1);
        }
      }

      // タスク抽出されなかったエントリも処理済みとして記録 (再処理防止)
      const processedEntryIds = new Set(parsed.tasks.flatMap((t) => t.logEntryIds ?? []));
      for (const entry of targetEntries) {
        if (!processedEntryIds.has(entry.entryId)) {
          recordExtractionLog(db, "task", "server-log", entry.entryId, 0);
        }
      }

      consola.info(
        `[tasks/extract-logs] Extracted ${createdTasks.length} tasks from ${targetEntries.length} log entries (${groupedEntries.length} groups)`,
      );

      return c.json({
        extracted: createdTasks.length,
        processed: targetEntries.length,
        skipped,
        grouped: groupedEntries.length,
        tasks: createdTasks,
      });
    } catch (error) {
      consola.error("[tasks/extract-logs] Failed to extract tasks:", error);
      return c.json({ error: "Failed to extract tasks from logs", details: String(error) }, 500);
    }
  });

  return router;
}

/**
 * Few-shot examples を構築
 */
function buildFewShotExamples(db: AdasDatabase): string {
  // 承認されたタスク (正例) - 修正なしで承認されたもの
  const acceptedTasks = db
    .select({
      title: schema.tasks.title,
      slackMessageId: schema.tasks.slackMessageId,
      originalTitle: schema.tasks.originalTitle,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.status, "accepted"))
    .orderBy(desc(schema.tasks.acceptedAt))
    .limit(10) // 修正あり/なしを分けるため多めに取得
    .all();

  // 修正なしで承認されたタスク
  const acceptedWithoutCorrection = acceptedTasks.filter((t) => !t.originalTitle).slice(0, 5);

  // 修正して承認されたタスク (改善例)
  const acceptedWithCorrection = acceptedTasks.filter((t) => t.originalTitle).slice(0, 5);

  // 却下されたタスク (負例)
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
      // メッセージ本文を取得
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

/**
 * 過去の処理済みタスク(完了・却下)を取得してプロンプト用テキストを生成
 */
function buildProcessedTasksSection(db: AdasDatabase): string {
  // 過去30日間の完了タスクを取得
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0] ?? "";

  // 完了済み親タスク (親を持たないタスク) を取得
  const completedParentTasks = db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      description: schema.tasks.description,
      completedAt: schema.tasks.completedAt,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "completed"),
        gte(schema.tasks.date, thirtyDaysAgoStr),
        isNull(schema.tasks.parentId),
      ),
    )
    .orderBy(desc(schema.tasks.completedAt))
    .limit(20)
    .all();

  // 過去30日間の却下タスク (親を持たないタスク) を取得
  const rejectedParentTasks = db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      description: schema.tasks.description,
      rejectReason: schema.tasks.rejectReason,
      rejectedAt: schema.tasks.rejectedAt,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "rejected"),
        gte(schema.tasks.date, thirtyDaysAgoStr),
        isNull(schema.tasks.parentId),
      ),
    )
    .orderBy(desc(schema.tasks.rejectedAt))
    .limit(20)
    .all();

  if (completedParentTasks.length === 0 && rejectedParentTasks.length === 0) {
    return "";
  }

  let section = "\n\n## 過去の処理済みタスク (類似チェック用)\n";
  section +=
    "新しいタスクがこれらに類似している場合は、`similarTo` フィールドで報告してください。\n";

  if (completedParentTasks.length > 0) {
    section += "\n### 完了済みタスク:\n";
    for (const task of completedParentTasks) {
      section += `- ${task.title}`;
      if (task.description) {
        section += ` (${task.description.slice(0, 50)}...)`;
      }
      section += "\n";

      // 子タスクを取得して表示
      const childTasks = getChildTasks(db, task.id);
      for (const child of childTasks) {
        section += `  - Step ${child.stepNumber}: ${child.title} [完了]\n`;
      }
    }
  }

  if (rejectedParentTasks.length > 0) {
    section += "\n### 却下されたタスク:\n";
    for (const task of rejectedParentTasks) {
      section += `- ${task.title}`;
      if (task.rejectReason) {
        section += ` (却下理由: ${task.rejectReason})`;
      }
      section += "\n";
    }
  }

  return section;
}

/**
 * 類似チェック用のプロンプトを構築
 */
function buildSimilarityCheckPrompt(
  task: { title: string; description: string | null },
  processedTasksSection: string,
): string {
  return `あなたはタスクの類似性を判定するアシスタントです。

以下のタスクが、過去の完了・却下タスクと類似しているかを判定してください。

## 対象タスク
タイトル: ${task.title}
${task.description ? `説明: ${task.description}` : ""}

${processedTasksSection}

## 判定基準
1. **同一タスクの再依頼**: タイトルや内容がほぼ同じ → 類似
2. **関連タスク**: 同じ機能・モジュールに関する別の依頼 → 類似
3. **無関係**: 全く異なる内容 → 類似なし

## 出力形式

JSON で出力してください。類似タスクがない場合は similarTo を null にしてください。

\`\`\`json
{
  "similarTo": {
    "title": "類似する過去タスクのタイトル",
    "status": "completed" または "rejected",
    "reason": "類似と判断した理由"
  } | null
}
\`\`\``;
}

interface SimilarityCheckResultInternal {
  similarTo: {
    title: string;
    status: "completed" | "rejected";
    reason: string;
  } | null;
}

/**
 * 個別タスクの類似チェックを実行
 */
async function checkTaskSimilarity(
  db: AdasDatabase,
  task: Task,
): Promise<CheckTaskSimilarityResponse> {
  const processedTasksSection = buildProcessedTasksSection(db);

  // 過去タスクがない場合はスキップ
  if (!processedTasksSection) {
    return { updated: false, similarTo: null };
  }

  const prompt = buildSimilarityCheckPrompt(task, processedTasksSection);

  try {
    const response = await runClaude({
      model: "haiku",
      prompt,
      maxTokens: 1024,
    });

    // JSON をパース
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch?.[1]) {
      consola.warn(`[tasks/check-similarity] Failed to parse response for task #${task.id}`);
      return { updated: false, similarTo: null };
    }

    const result = JSON.parse(jsonMatch[1]) as SimilarityCheckResultInternal;

    if (result.similarTo) {
      // DB を更新
      db.update(schema.tasks)
        .set({
          similarToTitle: result.similarTo.title,
          similarToStatus: result.similarTo.status,
          similarToReason: result.similarTo.reason,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.tasks.id, task.id))
        .run();

      consola.info(
        `[tasks/check-similarity] Task #${task.id} similar to "${result.similarTo.title}" (${result.similarTo.status})`,
      );

      return {
        updated: true,
        similarTo: result.similarTo,
      };
    }

    return { updated: false, similarTo: null };
  } catch (error) {
    consola.error(`[tasks/check-similarity] Error checking task #${task.id}:`, error);
    return { updated: false, similarTo: null };
  }
}

/**
 * ユーザープロンプトを構築
 */
function buildUserPrompt(
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

/**
 * GitHub コメント用のプロンプトを構築
 */
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

/**
 * メモ用のプロンプトを構築
 */
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

/**
 * LLM レスポンスをパース
 */
function parseExtractResult(response: string): ExtractResult {
  try {
    // JSON ブロックを抽出
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

    const parsed = JSON.parse(jsonStr);
    return parsed as ExtractResult;
  } catch {
    // パース失敗時は空配列を返す
    return { tasks: [] };
  }
}

/**
 * プロフィール提案を承認してプロフィールに反映
 */
async function applyProfileSuggestion(
  db: AdasDatabase,
  suggestionId: number,
  now: string,
): Promise<void> {
  const suggestion = db
    .select()
    .from(schema.profileSuggestions)
    .where(eq(schema.profileSuggestions.id, suggestionId))
    .get();

  if (!suggestion || suggestion.status !== "pending") {
    return;
  }

  const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

  if (!profile) {
    return;
  }

  if (suggestion.field === "experienceYears") {
    db.update(schema.userProfile)
      .set({
        experienceYears: Number.parseInt(suggestion.value, 10),
        updatedAt: now,
      })
      .where(eq(schema.userProfile.id, 1))
      .run();
  } else {
    // JSON配列フィールド (specialties, knownTechnologies, learningGoals)
    const fieldMap: Record<string, keyof typeof profile> = {
      specialties: "specialties",
      knownTechnologies: "knownTechnologies",
      learningGoals: "learningGoals",
    };

    const fieldKey = fieldMap[suggestion.field];
    if (fieldKey) {
      const currentValue = profile[fieldKey] as string | null;
      const currentArray: string[] = currentValue ? JSON.parse(currentValue) : [];

      // 重複チェック
      if (!currentArray.includes(suggestion.value)) {
        currentArray.push(suggestion.value);

        const updateObj: Record<string, string> = {
          [suggestion.field]: JSON.stringify(currentArray),
          updatedAt: now,
        };

        db.update(schema.userProfile).set(updateObj).where(eq(schema.userProfile.id, 1)).run();
      }
    }
  }

  // 提案ステータスを更新
  db.update(schema.profileSuggestions)
    .set({
      status: "accepted",
      acceptedAt: now,
    })
    .where(eq(schema.profileSuggestions.id, suggestionId))
    .run();
}

/**
 * 用語提案を承認して vocabulary テーブルに追加
 */
async function applyVocabularySuggestion(
  db: AdasDatabase,
  suggestionId: number,
  now: string,
): Promise<void> {
  const suggestion = db
    .select()
    .from(schema.vocabularySuggestions)
    .where(eq(schema.vocabularySuggestions.id, suggestionId))
    .get();

  if (!suggestion || suggestion.status !== "pending") {
    return;
  }

  // 既存の vocabulary をチェック (重複防止)
  const existing = db
    .select()
    .from(schema.vocabulary)
    .where(eq(schema.vocabulary.term, suggestion.term))
    .get();

  if (!existing) {
    // vocabulary テーブルに追加
    db.insert(schema.vocabulary)
      .values({
        term: suggestion.term,
        reading: suggestion.reading,
        category: suggestion.category,
        source: "interpret",
        usageCount: 0,
      })
      .run();

    consola.info(`[tasks] Added vocabulary: ${suggestion.term}`);
  } else {
    consola.debug(`[tasks] Vocabulary already exists: ${suggestion.term}`);
  }

  // 提案ステータスを更新
  db.update(schema.vocabularySuggestions)
    .set({
      status: "accepted",
      acceptedAt: now,
    })
    .where(eq(schema.vocabularySuggestions.id, suggestionId))
    .run();
}

/**
 * プロンプト改善を適用
 */
async function applyPromptImprovement(
  db: AdasDatabase,
  improvementId: number,
  now: string,
): Promise<void> {
  const improvement = db
    .select()
    .from(schema.promptImprovements)
    .where(eq(schema.promptImprovements.id, improvementId))
    .get();

  if (!improvement || improvement.status !== "pending") {
    return;
  }

  // プロンプトファイルを更新
  const promptPath = getPromptFilePath(improvement.target as PromptTarget);
  writeFileSync(promptPath, improvement.newPrompt, "utf-8");

  consola.info(`[tasks] Applied prompt improvement for: ${improvement.target}`);

  // 提案ステータスを更新
  db.update(schema.promptImprovements)
    .set({
      status: "approved",
      approvedAt: now,
    })
    .where(eq(schema.promptImprovements.id, improvementId))
    .run();
}

/**
 * プロジェクト提案を承認してプロジェクトを作成
 */
async function applyProjectSuggestion(
  db: AdasDatabase,
  suggestionId: number,
  now: string,
): Promise<void> {
  const suggestion = db
    .select()
    .from(schema.projectSuggestions)
    .where(eq(schema.projectSuggestions.id, suggestionId))
    .get();

  if (!suggestion || suggestion.status !== "pending") {
    return;
  }

  // 既存プロジェクトの重複チェック (path または owner/repo で)
  let existingProject = null;

  if (suggestion.path) {
    existingProject = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.path, suggestion.path))
      .get();
  }

  if (!existingProject && suggestion.githubOwner && suggestion.githubRepo) {
    existingProject = db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.githubOwner, suggestion.githubOwner),
          eq(schema.projects.githubRepo, suggestion.githubRepo),
        ),
      )
      .get();
  }

  if (!existingProject) {
    // プロジェクトを作成
    db.insert(schema.projects)
      .values({
        name: suggestion.name,
        path: suggestion.path,
        githubOwner: suggestion.githubOwner,
        githubRepo: suggestion.githubRepo,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    consola.info(`[tasks] Created project: ${suggestion.name}`);
  } else {
    consola.debug(`[tasks] Project already exists: ${suggestion.name}`);
  }

  // 提案ステータスを更新
  db.update(schema.projectSuggestions)
    .set({
      status: "accepted",
      acceptedAt: now,
    })
    .where(eq(schema.projectSuggestions.id, suggestionId))
    .run();
}

// ========== タスク完了検知関数 ==========

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

    if (!repo || !number) {
      return null;
    }

    // owner が不明な場合、プロジェクト設定や GitHub username から推測を試みる
    if (!owner) {
      // description に owner/repo 形式がなかった場合、owner を特定できない
      // 今後の拡張: プロジェクト設定から owner を取得するなど
      consola.debug(`[completion-check] Cannot determine owner for ${repo}#${number}`);
      return null;
    }

    // GitHub API で最新状態を取得
    const state = await getItemState(owner, repo, number);

    if (!state) {
      return null;
    }

    // 完了判定
    if (state.state === "merged") {
      return {
        reason: `PR ${repo}#${number} がマージされました`,
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
  request: CheckCompletionRequest,
): Promise<CheckCompletionResponse | null> {
  try {
    const config = loadConfig();
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
    const result = await callWorkerCheckCompletion({
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

/**
 * Slack メッセージでの完了をチェック
 */
async function checkSlackCompletion(
  db: AdasDatabase,
  task: {
    id: number;
    slackMessageId: number | null;
    title: string;
    description: string | null;
    parentId: number | null;
  },
): Promise<CompletionCheckResult | null> {
  if (!task.slackMessageId) {
    return null;
  }

  try {
    // 元のメッセージを取得
    const originalMessage = db
      .select()
      .from(schema.slackMessages)
      .where(eq(schema.slackMessages.id, task.slackMessageId))
      .get();

    if (!originalMessage) {
      return null;
    }

    // 同じスレッドの後続メッセージを取得
    const followUpMessages = db
      .select()
      .from(schema.slackMessages)
      .where(
        and(
          eq(schema.slackMessages.channelId, originalMessage.channelId),
          originalMessage.threadTs
            ? eq(schema.slackMessages.threadTs, originalMessage.threadTs)
            : eq(schema.slackMessages.threadTs, originalMessage.messageTs),
          gte(schema.slackMessages.messageTs, originalMessage.messageTs),
        ),
      )
      .orderBy(schema.slackMessages.messageTs)
      .limit(20)
      .all();

    // 元メッセージを除く後続メッセージのみ
    const laterMessages = followUpMessages.filter((m) => m.messageTs !== originalMessage.messageTs);

    if (laterMessages.length === 0) {
      return null;
    }

    // コンテキストを構築
    const contextParts: string[] = [];
    contextParts.push(`--- 元のメッセージ ---`);
    contextParts.push(`[${originalMessage.userName ?? "unknown"}] ${originalMessage.text}`);
    contextParts.push(`--- 後続メッセージ ---`);
    for (const msg of laterMessages) {
      contextParts.push(`[${msg.userName ?? "unknown"}] ${msg.text}`);
    }

    const context = contextParts.join("\n");

    // 子タスク・親タスク情報を取得
    const childTasks = getChildTasks(db, task.id);
    const parentTask = task.parentId ? getParentTask(db, task) : null;

    // Worker で AI 判定
    const result = await callWorkerCheckCompletion({
      task: {
        title: task.title,
        description: task.description,
        childTasks: childTasks.length > 0 ? formatChildTasksForCompletion(childTasks) : undefined,
        parentTask: parentTask ? { id: parentTask.id, title: parentTask.title } : undefined,
      },
      context,
      source: "slack",
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
    consola.warn("[completion-check] Slack check failed:", err);
    return null;
  }
}

/**
 * Transcribe (音声書き起こし) での完了をチェック
 */
async function checkTranscribeCompletion(
  db: AdasDatabase,
  task: {
    id: number;
    date: string;
    title: string;
    description: string | null;
    acceptedAt: string | null;
    parentId: number | null;
  },
): Promise<CompletionCheckResult | null> {
  try {
    // タスクの日付以降の音声書き起こしを取得
    const segments = db
      .select()
      .from(schema.transcriptionSegments)
      .where(
        and(
          gte(schema.transcriptionSegments.date, task.date),
          task.acceptedAt
            ? gte(schema.transcriptionSegments.startTime, task.acceptedAt)
            : undefined,
        ),
      )
      .orderBy(desc(schema.transcriptionSegments.startTime))
      .limit(30)
      .all();

    if (segments.length === 0) {
      return null;
    }

    // interpretedText があるセグメントを優先
    const contextParts: string[] = [];
    for (const seg of segments.reverse()) {
      const text = seg.interpretedText ?? seg.transcription;
      if (text) {
        contextParts.push(`[${seg.startTime}] ${text}`);
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
    const result = await callWorkerCheckCompletion({
      task: {
        title: task.title,
        description: task.description,
        childTasks: childTasks.length > 0 ? formatChildTasksForCompletion(childTasks) : undefined,
        parentTask: parentTask ? { id: parentTask.id, title: parentTask.title } : undefined,
      },
      context,
      source: "transcribe",
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
    consola.warn("[completion-check] Transcribe check failed:", err);
    return null;
  }
}

// ========== 依存関係保存関数 ==========

interface TaskWithDependencies {
  task: typeof schema.tasks.$inferSelect;
  extractedDependencies: ExtractedTaskDependency[];
}

/**
 * 依存関係を解決して保存
 * @param db データベース
 * @param tasksWithDeps タスクと抽出された依存関係のリスト
 */
function saveDependencies(db: AdasDatabase, tasksWithDeps: TaskWithDependencies[]): void {
  // 同バッチ内のタスクタイトル -> ID のマップを作成
  const batchTaskMap = new Map<string, number>();
  for (const { task } of tasksWithDeps) {
    batchTaskMap.set(task.title.toLowerCase(), task.id);
  }

  // 既存の未完了タスクを取得 (accepted, in_progress, paused)
  const existingTasks = db
    .select({ id: schema.tasks.id, title: schema.tasks.title })
    .from(schema.tasks)
    .where(inArray(schema.tasks.status, ["accepted", "in_progress", "paused"]))
    .all();

  const existingTaskMap = new Map<string, number>();
  for (const task of existingTasks) {
    existingTaskMap.set(task.title.toLowerCase(), task.id);
  }

  for (const { task, extractedDependencies } of tasksWithDeps) {
    if (!extractedDependencies || extractedDependencies.length === 0) {
      continue;
    }

    for (const dep of extractedDependencies) {
      const depTitleLower = dep.taskTitle.toLowerCase();

      // まず同バッチ内のタスクを検索
      let dependsOnTaskId = batchTaskMap.get(depTitleLower);

      // 同バッチ内になければ既存タスクを検索
      if (!dependsOnTaskId) {
        dependsOnTaskId = existingTaskMap.get(depTitleLower);
      }

      // 部分一致でも検索 (タイトルが完全一致しない場合)
      if (!dependsOnTaskId) {
        // 同バッチ内で部分一致
        for (const [title, id] of batchTaskMap.entries()) {
          if (title.includes(depTitleLower) || depTitleLower.includes(title)) {
            dependsOnTaskId = id;
            break;
          }
        }
      }

      if (!dependsOnTaskId) {
        // 既存タスクで部分一致
        for (const [title, id] of existingTaskMap.entries()) {
          if (title.includes(depTitleLower) || depTitleLower.includes(title)) {
            dependsOnTaskId = id;
            break;
          }
        }
      }

      if (!dependsOnTaskId) {
        consola.debug(`[tasks] Dependency not found: ${dep.taskTitle} for task ${task.title}`);
        continue;
      }

      // 自己参照は除外
      if (dependsOnTaskId === task.id) {
        continue;
      }

      // 依存関係を保存 (重複は無視)
      try {
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
        consola.debug(
          `[tasks] Saved dependency: ${task.title} depends on task #${dependsOnTaskId}`,
        );
      } catch {
        // UNIQUE constraint violation は無視
      }
    }
  }
}

// ========== マージ実行関数 ==========

/**
 * タスク統合を実行
 * 1. 統合元タスクを completed に更新 (mergedAt, mergeTargetTaskId を設定)
 * 2. 依存関係を統合先に移行
 * @param db データベース
 * @param mergeTask マージタスク
 * @param now 現在時刻
 */
async function executeMerge(
  db: AdasDatabase,
  mergeTask: typeof schema.tasks.$inferSelect,
  now: string,
): Promise<void> {
  if (!mergeTask.mergeSourceTaskIds) {
    consola.warn(`[executeMerge] No source task IDs for merge task #${mergeTask.id}`);
    return;
  }

  const sourceTaskIds: number[] = JSON.parse(mergeTask.mergeSourceTaskIds);

  if (sourceTaskIds.length === 0) {
    consola.warn(`[executeMerge] Empty source task IDs for merge task #${mergeTask.id}`);
    return;
  }

  consola.info(`[executeMerge] Merging tasks ${sourceTaskIds.join(", ")} into #${mergeTask.id}`);

  // 1. 統合元タスクを completed に更新
  for (const sourceTaskId of sourceTaskIds) {
    db.update(schema.tasks)
      .set({
        status: "completed",
        completedAt: now,
        mergeTargetTaskId: mergeTask.id,
        mergedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, sourceTaskId))
      .run();
  }

  // 2. 依存関係を統合先に移行
  // 統合元タスクがブロックしていたタスク → 統合先がブロックするように変更
  for (const sourceTaskId of sourceTaskIds) {
    const blocksDeps = db
      .select()
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.dependsOnTaskId, sourceTaskId))
      .all();

    for (const dep of blocksDeps) {
      // 統合先タスク自身への依存は除外
      if (dep.taskId === mergeTask.id) continue;
      // 他の統合元タスクへの依存も除外 (統合後は不要)
      if (sourceTaskIds.includes(dep.taskId)) continue;

      // 既に同じ依存関係がないかチェック
      const existing = db
        .select()
        .from(schema.taskDependencies)
        .where(
          and(
            eq(schema.taskDependencies.taskId, dep.taskId),
            eq(schema.taskDependencies.dependsOnTaskId, mergeTask.id),
          ),
        )
        .get();

      if (!existing) {
        // 新しい依存関係を作成
        db.insert(schema.taskDependencies)
          .values({
            taskId: dep.taskId,
            dependsOnTaskId: mergeTask.id,
            dependencyType: dep.dependencyType,
            confidence: dep.confidence,
            reason: `Migrated from merged task #${sourceTaskId}: ${dep.reason ?? ""}`,
            sourceType: "auto",
          })
          .run();
      }

      // 元の依存関係は削除
      db.delete(schema.taskDependencies).where(eq(schema.taskDependencies.id, dep.id)).run();
    }
  }

  // 統合元タスクをブロックしていた依存関係は削除 (統合元は completed になるため)
  for (const sourceTaskId of sourceTaskIds) {
    db.delete(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, sourceTaskId))
      .run();
  }

  consola.info(`[executeMerge] Successfully merged tasks into #${mergeTask.id}`);
}

// ---------------------------------------------------------------------------
// Server Log Task Extraction Helpers
// ---------------------------------------------------------------------------

interface LogEntryWithId extends LogEntry {
  entryId: string;
}

interface GroupedLogEntry {
  pattern: string;
  count: number;
  entries: LogEntryWithId[];
  firstTimestamp: string;
  lastTimestamp: string;
  sampleMessage: string;
}

interface ExtractedLogTask {
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  workType?: "investigate" | "operate" | "maintain";
  confidence?: number;
  logEntryIds?: string[];
}

interface LogExtractResult {
  tasks: ExtractedLogTask[];
}

/**
 * ログエントリの一意な識別子を生成
 * フォーマット: {source}-{date}-{hash}
 * hash は timestamp + level + message (正規化済み) の MD5 先頭 8 文字
 */
function generateLogEntryId(source: string, date: string, entry: LogEntry): string {
  const normalized = normalizeLogMessage(entry.message);
  const input = `${entry.timestamp}|${entry.level}|${normalized}`;
  const hash = createHash("md5").update(input).digest("hex").slice(0, 8);
  return `${source}-${date}-${hash}`;
}

/**
 * ログメッセージを正規化 (動的な値をプレースホルダに置換)
 */
function normalizeLogMessage(message: string): string {
  return (
    message
      // UUID
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
      // ISO 8601 タイムスタンプ
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g, "<TIMESTAMP>")
      // 数値 (3桁以上)
      .replace(/\b\d{3,}\b/g, "<NUM>")
      // IP アドレス
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<IP>")
      // ファイルパス (絶対パス)
      .replace(/\/[^\s:]+/g, "<PATH>")
  );
}

/**
 * 類似したログエントリをグループ化
 */
function groupSimilarLogEntries(entries: LogEntryWithId[]): GroupedLogEntry[] {
  const groups = new Map<string, GroupedLogEntry>();

  for (const entry of entries) {
    const pattern = normalizeLogMessage(entry.message);

    if (groups.has(pattern)) {
      const group = groups.get(pattern)!;
      group.count++;
      group.entries.push(entry);
      if (entry.timestamp < group.firstTimestamp) {
        group.firstTimestamp = entry.timestamp;
      }
      if (entry.timestamp > group.lastTimestamp) {
        group.lastTimestamp = entry.timestamp;
      }
    } else {
      groups.set(pattern, {
        pattern,
        count: 1,
        entries: [entry],
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        sampleMessage: entry.message,
      });
    }
  }

  // 発生回数の多い順にソート
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

/**
 * ログ抽出用のユーザープロンプトを構築
 */
function buildLogExtractionPrompt(groups: GroupedLogEntry[], date: string, source: string): string {
  const lines: string[] = [];
  lines.push(`## ログ分析対象`);
  lines.push(`- ソース: ${source}`);
  lines.push(`- 日付: ${date}`);
  lines.push(`- グループ数: ${groups.length}`);
  lines.push(`- 総エントリ数: ${groups.reduce((sum, g) => sum + g.count, 0)}`);
  lines.push("");
  lines.push("## エラー/警告グループ");
  lines.push("");

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    lines.push(`### グループ ${i + 1} (発生回数: ${group.count})`);
    lines.push(`- 初回発生: ${group.firstTimestamp}`);
    lines.push(`- 最終発生: ${group.lastTimestamp}`);
    lines.push(`- レベル: ${group.entries[0].level}`);
    lines.push(`- サンプルメッセージ:`);
    lines.push("```");
    lines.push(group.sampleMessage);
    lines.push("```");
    lines.push(`- エントリID一覧: ${group.entries.map((e) => e.entryId).join(", ")}`);
    lines.push("");
  }

  lines.push("## 指示");
  lines.push("上記のログエントリを分析し、対応すべきタスクを抽出してください。");
  lines.push("各タスクには関連するエントリIDを `logEntryIds` に含めてください。");

  return lines.join("\n");
}

/**
 * ログ抽出結果のパース
 */
function parseLogExtractResult(response: string): LogExtractResult {
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : response;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    consola.warn("[parseLogExtractResult] Failed to parse JSON:", jsonStr.slice(0, 200));
    return { tasks: [] };
  }
}
