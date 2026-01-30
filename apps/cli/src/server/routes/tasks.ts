/**
 * Tasks API Routes
 *
 * Slack メッセージから抽出したタスクの管理
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase, SlackMessage } from "@repo/db";
import { schema } from "@repo/db";
import type { TaskStatus } from "@repo/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { getTodayDateString } from "../../utils/date";

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
   * - limit: number (optional, defaults to 100)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const status = c.req.query("status") as TaskStatus | undefined;
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

    const conditions = [];

    if (date) {
      conditions.push(eq(schema.tasks.date, date));
    }

    if (status) {
      conditions.push(eq(schema.tasks.status, status));
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
   * PATCH /api/tasks/:id
   *
   * タスクのステータス更新
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
      } else if (body.status === "rejected") {
        updates.rejectedAt = now;
        if (body.rejectReason) {
          updates.rejectReason = body.rejectReason;
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
      // PR のレビュー依頼
      if (item.itemType === "pull_request" && item.isReviewRequested) {
        const title = `Review PR: ${item.repoName}#${item.number}`;
        if (!existingTaskTitles.includes(title)) {
          const task = db
            .insert(schema.tasks)
            .values({
              date,
              slackMessageId: null,
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

      // アサインされた Issue
      if (item.itemType === "issue" && item.assigneeLogin) {
        const title = `Fix Issue: ${item.repoName}#${item.number}`;
        if (!existingTaskTitles.includes(title)) {
          const task = db
            .insert(schema.tasks)
            .values({
              date,
              slackMessageId: null,
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

  return router;
}

/**
 * Few-shot examples を構築
 */
function buildFewShotExamples(db: AdasDatabase): string {
  // 承認されたタスク (正例)
  const acceptedTasks = db
    .select({
      title: schema.tasks.title,
      slackMessageId: schema.tasks.slackMessageId,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.status, "accepted"))
    .orderBy(desc(schema.tasks.acceptedAt))
    .limit(5)
    .all();

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

  if (acceptedTasks.length === 0 && rejectedTasks.length === 0) {
    return "";
  }

  let examples = "\n\n## 過去の判断例\n";

  if (acceptedTasks.length > 0) {
    examples += "\n### タスクとして承認されたもの:\n";
    for (const task of acceptedTasks) {
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
${context.length > 0 ? context.join(" / ") + "\n" : ""}
${message.text}`;
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
