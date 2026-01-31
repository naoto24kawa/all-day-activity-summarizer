/**
 * Tasks API Routes
 *
 * Slack メッセージから抽出したタスクの管理
 */

import { readFileSync, writeFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase, SlackMessage } from "@repo/db";
import { schema } from "@repo/db";
import {
  type CheckCompletionRequest,
  type CheckCompletionResponse,
  type CheckDuplicatesResponse,
  type CreateMergeTaskResponse,
  type DetectDuplicatesResponse,
  type ElaborateTaskRequest,
  type ElaborateTaskResponse,
  isApprovalOnlyTask,
  type PromptTarget,
  type SuggestCompletionsResponse,
  type Task,
  type TaskCompletionSuggestion,
  type TaskStatus,
} from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import { loadConfig } from "../../config";
import { getItemState } from "../../github/client";
import { getTodayDateString } from "../../utils/date";
import { hasExtractionLog, recordExtractionLog } from "../../utils/extraction-log.js";
import { findOrCreateProjectByGitHub } from "../../utils/project-lookup.js";
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
    const status = c.req.query("status") as TaskStatus | undefined;
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

    return c.json(tasks);
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
   * Body: { date?: string }
   */
  router.post("/extract-memos", async (c) => {
    const body = await c.req.json<{ date?: string }>();
    const date = body.date ?? getTodayDateString();

    // メモを取得
    const memos = db.select().from(schema.memos).where(eq(schema.memos.date, date)).all();

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
   * タスクを AI で詳細化
   * コードベースを参照しながら実装手順や対象ファイルを含む詳細を生成
   * Body: ElaborateTaskRequest
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

    const body = await c.req.json<ElaborateTaskRequest>().catch(() => ({}));

    // プロジェクト情報を取得
    let project = null;
    if (task.projectId) {
      project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId))
        .get();
    }

    // プロンプトを構築
    const systemPrompt = readFileSync(getPromptFilePath("task-elaborate"), "utf-8");

    let userPrompt = `# タスク情報\n\n`;
    userPrompt += `**タイトル**: ${task.title}\n\n`;

    if (task.description) {
      userPrompt += `**現在の説明**:\n${task.description}\n\n`;
    }

    if (project) {
      userPrompt += `**プロジェクト**: ${project.name}\n`;
      if (project.path) {
        userPrompt += `**プロジェクトパス**: ${project.path}\n`;
      }
      userPrompt += "\n";
    }

    // 修正依頼の場合
    if (body.currentElaboration && body.revisionInstruction) {
      userPrompt += `## 修正依頼\n\n`;
      userPrompt += `**現在の詳細化結果**:\n${body.currentElaboration}\n\n`;
      userPrompt += `**修正指示**: ${body.revisionInstruction}\n\n`;
      userPrompt += `上記の修正指示に従って、詳細化結果を改善してください。\n`;
    } else if (body.userInstruction) {
      // 初回詳細化で追加指示がある場合
      userPrompt += `## ユーザー指示\n${body.userInstruction}\n\n`;
      userPrompt += `上記の指示を考慮してタスクを詳細化してください。\n`;
    } else {
      userPrompt += `このタスクを詳細化してください。\n`;
    }

    // vocabulary セクションを追加
    const vocabularySection = buildVocabularySection(db);
    if (vocabularySection) {
      userPrompt += `\n${vocabularySection}\n`;
    }

    try {
      const cwd = project?.path ?? undefined;
      const allowedTools = cwd ? "Glob,Grep,Read" : undefined;
      const disableTools = !cwd;

      consola.info(`[tasks/elaborate] Starting elaboration for task ${id} (cwd: ${cwd ?? "none"})`);

      const response = await runClaude(userPrompt, {
        model: "sonnet",
        systemPrompt,
        allowedTools,
        disableTools,
        cwd,
        dangerouslySkipPermissions: true,
      });

      // レスポンスからファイルパスを抽出 (パターンマッチング)
      const filePatterns = [
        /`([^`]+\.[a-z]{1,4})`/g, // バッククォートで囲まれたファイルパス
        /- `([^`]+\.[a-z]{1,4})`/g, // リスト項目のファイルパス
      ];

      const referencedFiles = new Set<string>();
      for (const pattern of filePatterns) {
        for (const match of response.matchAll(pattern)) {
          const filePath = match[1];
          if (filePath && !filePath.includes(" ") && filePath.includes("/")) {
            referencedFiles.add(filePath);
          }
        }
      }

      const result: ElaborateTaskResponse = {
        elaboration: response,
        codebaseReferenced: !!cwd,
        referencedFiles: referencedFiles.size > 0 ? Array.from(referencedFiles) : undefined,
      };

      consola.success(
        `[tasks/elaborate] Done (${response.length} chars, ${referencedFiles.size} files referenced)`,
      );

      return c.json(result);
    } catch (error) {
      consola.error(`[tasks/elaborate] Failed:`, error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to elaborate task" },
        500,
      );
    }
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

    // マージタスクを作成 (pending として)
    const mergeTask = db
      .insert(schema.tasks)
      .values({
        date,
        sourceType: "merge",
        title: body.title,
        description: body.description ?? null,
        priority: priority ?? null,
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

  // 過去30日間の却下タスクを取得
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
    projectId: number | null;
    title: string;
    description: string | null;
    acceptedAt: string | null;
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

    // Worker で AI 判定
    const result = await callWorkerCheckCompletion({
      task: { title: task.title, description: task.description },
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
  task: { slackMessageId: number | null; title: string; description: string | null },
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

    // Worker で AI 判定
    const result = await callWorkerCheckCompletion({
      task: { title: task.title, description: task.description },
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
  task: { date: string; title: string; description: string | null; acceptedAt: string | null },
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

    // Worker で AI 判定
    const result = await callWorkerCheckCompletion({
      task: { title: task.title, description: task.description },
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
