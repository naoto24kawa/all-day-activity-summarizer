/**
 * Tasks API Routes
 *
 * Slack メッセージから抽出したタスクの管理
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase, SlackMessage } from "@repo/db";
import { schema } from "@repo/db";
import type {
  CheckCompletionRequest,
  CheckCompletionResponse,
  SuggestCompletionsResponse,
  Task,
  TaskCompletionSuggestion,
  TaskStatus,
} from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { loadConfig } from "../../config";
import { getItemState } from "../../github/client";
import { getTodayDateString } from "../../utils/date";
import { findOrCreateProjectByGitHub } from "../../utils/project-lookup.js";

interface ExtractedTask {
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  confidence?: number;
  dueDate?: string;
}

interface ExtractResult {
  tasks: ExtractedTask[];
}

export function createTasksRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/tasks
   *
   * Query params:
   * - date: YYYY-MM-DD (optional)
   * - status: pending | accepted | rejected | completed (optional)
   * - projectId: number (optional, filters by project)
   * - noProject: boolean (optional, filters tasks without project)
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const status = c.req.query("status") as TaskStatus | undefined;
    const projectIdStr = c.req.query("projectId");
    const noProject = c.req.query("noProject") === "true";
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    const conditions = [];

    if (date) {
      conditions.push(eq(schema.tasks.date, date));
    }

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
    text += "\n\n---\n";
    text += `作業開始前に以下を実行してください:\n`;
    text += `\`\`\`bash\n`;
    text += `curl -X POST ${baseUrl}/api/tasks/${task.id}/start\n`;
    text += `\`\`\`\n\n`;
    text += `タスク完了時は以下を実行してください:\n`;
    text += `\`\`\`bash\n`;
    text += `curl -X POST ${baseUrl}/api/tasks/${task.id}/complete\n`;
    text += `\`\`\`\n\n`;
    text += `中断する場合は以下を実行してください (理由は任意):\n`;
    text += `\`\`\`bash\n`;
    text += `curl -X POST ${baseUrl}/api/tasks/${task.id}/pause -H "Content-Type: application/json" -d '{"reason": "中断理由"}'\n`;
    text += `\`\`\``;

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
    }>();

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
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

    // 既に抽出済みのメッセージIDを除外
    const existingTasks = db
      .select({ slackMessageId: schema.tasks.slackMessageId })
      .from(schema.tasks)
      .where(
        inArray(
          schema.tasks.slackMessageId,
          messages.map((m) => m.id),
        ),
      )
      .all();

    const existingMessageIds = new Set(existingTasks.map((t) => t.slackMessageId));
    const targetMessages = messages.filter((m) => !existingMessageIds.has(m.id));

    if (targetMessages.length === 0) {
      return c.json({ extracted: 0, tasks: [], message: "All messages already processed" });
    }

    // Few-shot examples を構築 (過去の承認/却下履歴から)
    const fewShotExamples = buildFewShotExamples(db);

    // プロンプト読み込み
    const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

    const createdTasks = [];

    for (const message of targetMessages) {
      const userPrompt = buildUserPrompt(message, fewShotExamples);

      try {
        const response = await runClaude(userPrompt, {
          model: "haiku",
          systemPrompt,
          disableTools: true,
        });

        const parsed = parseExtractResult(response);

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
              })
              .returning()
              .get();

            createdTasks.push(task);
          }
        }
      } catch (error) {
        console.error(`Failed to extract tasks from message ${message.id}:`, error);
      }
    }

    return c.json({
      extracted: createdTasks.length,
      tasks: createdTasks,
    });
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

    // 既に抽出済みのコメントIDを除外
    const existingTasks = db
      .select({ githubCommentId: schema.tasks.githubCommentId })
      .from(schema.tasks)
      .where(
        inArray(
          schema.tasks.githubCommentId,
          comments.map((c) => c.id),
        ),
      )
      .all();

    const existingCommentIds = new Set(existingTasks.map((t) => t.githubCommentId));
    const targetComments = comments.filter((c) => !existingCommentIds.has(c.id));

    if (targetComments.length === 0) {
      return c.json({ extracted: 0, tasks: [], message: "All comments already processed" });
    }

    // Few-shot examples を構築
    const fewShotExamples = buildFewShotExamples(db);

    // プロンプト読み込み
    const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

    const createdTasks = [];

    for (const comment of targetComments) {
      // プロジェクト紐付け (repoOwner/repoName から)
      const projectId = findOrCreateProjectByGitHub(db, comment.repoOwner, comment.repoName);

      const userPrompt = buildGitHubCommentPrompt(comment, fewShotExamples);

      try {
        const response = await runClaude(userPrompt, {
          model: "haiku",
          systemPrompt,
          disableTools: true,
        });

        const parsed = parseExtractResult(response);

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
              })
              .returning()
              .get();

            createdTasks.push(task);
          }
        }
      } catch (error) {
        console.error(`Failed to extract tasks from comment ${comment.id}:`, error);
      }
    }

    return c.json({
      extracted: createdTasks.length,
      tasks: createdTasks,
    });
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

    // 既に抽出済みのメモIDを除外
    const existingTasks = db
      .select({ memoId: schema.tasks.memoId })
      .from(schema.tasks)
      .where(
        inArray(
          schema.tasks.memoId,
          memos.map((m) => m.id),
        ),
      )
      .all();

    const existingMemoIds = new Set(existingTasks.map((t) => t.memoId));
    const targetMemos = memos.filter((m) => !existingMemoIds.has(m.id));

    if (targetMemos.length === 0) {
      return c.json({ extracted: 0, tasks: [], message: "All memos already processed" });
    }

    // Few-shot examples を構築
    const fewShotExamples = buildFewShotExamples(db);

    // プロンプト読み込み
    const systemPrompt = readFileSync(getPromptFilePath("task-extract"), "utf-8");

    const createdTasks = [];

    for (const memo of targetMemos) {
      const userPrompt = buildMemoPrompt(memo, fewShotExamples);

      try {
        const response = await runClaude(userPrompt, {
          model: "haiku",
          systemPrompt,
          disableTools: true,
        });

        const parsed = parseExtractResult(response);

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
              })
              .returning()
              .get();

            createdTasks.push(task);
          }
        }
      } catch (error) {
        console.error(`Failed to extract tasks from memo ${memo.id}:`, error);
      }
    }

    return c.json({
      extracted: createdTasks.length,
      tasks: createdTasks,
    });
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
   */
  router.post("/:id/accept", (c) => {
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
   * PATCH /api/tasks/batch
   *
   * 一括ステータス更新
   * Body: { ids: number[], status: TaskStatus, reason?: string }
   */
  router.patch("/batch", async (c) => {
    const body = await c.req.json<{
      ids: number[];
      status: TaskStatus;
      reason?: string;
    }>();

    if (!body.ids || body.ids.length === 0) {
      return c.json({ error: "ids is required" }, 400);
    }

    if (!body.status) {
      return c.json({ error: "status is required" }, 400);
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      status: body.status,
      updatedAt: now,
    };

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
 * ユーザープロンプトを構築
 */
function buildUserPrompt(
  message: { text: string; userName: string | null; channelName: string | null },
  fewShotExamples: string,
): string {
  const context = [];
  if (message.userName) {
    context.push(`送信者: ${message.userName}`);
  }
  if (message.channelName) {
    context.push(`チャンネル: ${message.channelName}`);
  }

  return `以下のSlackメッセージからタスクを抽出してください。
${fewShotExamples}

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
): string {
  const context = [];
  if (comment.authorLogin) {
    context.push(`投稿者: ${comment.authorLogin}`);
  }
  context.push(`タイプ: ${comment.commentType}`);
  context.push(`リポジトリ: ${comment.repoName}#${comment.itemNumber}`);

  return `以下のGitHubコメントからタスクを抽出してください。
レビュー指摘や質問、依頼事項があればタスク化してください。
${fewShotExamples}

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
): string {
  return `以下のメモからタスクを抽出してください。
TODO、やること、対応が必要な内容があればタスク化してください。
${fewShotExamples}

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
