/**
 * Task Tools for MCP Server
 *
 * タスク管理関連の 5 ツール:
 * - list_tasks: タスク一覧取得
 * - get_tasks_for_ai: AI向けMarkdown形式
 * - create_task: タスク作成
 * - start_task: タスク開始
 * - complete_task: タスク完了
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Task, TaskPriority, WorkType } from "@repo/types";
import { z } from "zod";
import { apiGet, apiPost } from "../api-client.js";

export function registerTaskTools(server: McpServer): void {
  /**
   * list_tasks - タスク一覧取得
   */
  server.tool(
    "list_tasks",
    "タスク一覧を取得する。status でフィルタ可能 (pending/accepted/in_progress/completed/rejected)",
    {
      status: z
        .enum(["pending", "accepted", "rejected", "in_progress", "paused", "completed"])
        .optional()
        .describe("タスクステータスでフィルタ"),
      projectId: z.number().optional().describe("プロジェクトIDでフィルタ"),
      limit: z.number().optional().describe("取得件数の上限 (デフォルト: 100)"),
    },
    async ({ status, projectId, limit }) => {
      const response = await apiGet<Task[]>("/tasks", {
        status,
        projectId,
        limit,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `タスク取得エラー: ${response.error}`,
            },
          ],
        };
      }

      const tasks = response.data;

      if (tasks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "該当するタスクはありません。",
            },
          ],
        };
      }

      const taskList = tasks
        .map((t) => {
          const priority = t.priority ? `[${t.priority}]` : "";
          const dueDate = t.dueDate ? ` (期限: ${t.dueDate})` : "";
          return `- #${t.id} ${priority} ${t.title} (${t.status})${dueDate}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `タスク一覧 (${tasks.length}件):\n\n${taskList}`,
          },
        ],
      };
    },
  );

  /**
   * get_tasks_for_ai - AI向けMarkdown形式
   */
  server.tool(
    "get_tasks_for_ai",
    "AI エージェント向けのタスク一覧を Markdown 形式で取得。承認済み (accepted) タスクのみ、優先度順にソート済み",
    {
      date: z.string().optional().describe("日付でフィルタ (YYYY-MM-DD)"),
      projectId: z.number().optional().describe("プロジェクトIDでフィルタ"),
      limit: z.number().optional().describe("取得件数の上限 (デフォルト: 20)"),
    },
    async ({ date, projectId, limit }) => {
      const response = await apiGet<string>("/tasks/for-ai", {
        date,
        projectId,
        limit,
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `タスク取得エラー: ${response.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: response.data,
          },
        ],
      };
    },
  );

  /**
   * create_task - タスク作成
   */
  server.tool(
    "create_task",
    "新しいタスクを作成する。作成後は accepted 状態になる",
    {
      title: z.string().describe("タスクのタイトル"),
      description: z.string().optional().describe("タスクの詳細説明"),
      priority: z
        .enum(["high", "medium", "low", "someday"])
        .optional()
        .describe("優先度 (high/medium/low/someday)"),
      workType: z
        .enum([
          "create",
          "investigate",
          "review",
          "communicate",
          "operate",
          "learn",
          "plan",
          "maintain",
        ])
        .optional()
        .describe("業務パターン"),
      dueDate: z.string().optional().describe("期限日 (YYYY-MM-DD)"),
      projectId: z.number().optional().describe("紐づけるプロジェクトID"),
    },
    async ({ title, description, priority, workType, dueDate, projectId }) => {
      const response = await apiPost<Task>("/tasks", {
        title,
        description,
        priority,
        workType,
        dueDate,
        projectId,
        status: "accepted",
      });

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `タスク作成エラー: ${response.error}`,
            },
          ],
        };
      }

      const task = response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `タスクを作成しました:\n- ID: #${task.id}\n- タイトル: ${task.title}\n- ステータス: ${task.status}${task.priority ? `\n- 優先度: ${task.priority}` : ""}${task.dueDate ? `\n- 期限: ${task.dueDate}` : ""}`,
          },
        ],
      };
    },
  );

  /**
   * start_task - タスク開始
   */
  server.tool(
    "start_task",
    "タスクを開始する (accepted → in_progress)",
    {
      taskId: z.number().describe("開始するタスクのID"),
    },
    async ({ taskId }) => {
      const response = await apiPost<Task>(`/tasks/${taskId}/start`);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `タスク開始エラー: ${response.error}`,
            },
          ],
        };
      }

      const task = response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `タスク #${task.id} を開始しました:\n- タイトル: ${task.title}\n- ステータス: ${task.status}`,
          },
        ],
      };
    },
  );

  /**
   * complete_task - タスク完了
   */
  server.tool(
    "complete_task",
    "タスクを完了する (→ completed)",
    {
      taskId: z.number().describe("完了するタスクのID"),
    },
    async ({ taskId }) => {
      const response = await apiPost<Task>(`/tasks/${taskId}/complete`);

      if (!response.ok || !response.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `タスク完了エラー: ${response.error}`,
            },
          ],
        };
      }

      const task = response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `タスク #${task.id} を完了しました:\n- タイトル: ${task.title}\n- 完了日時: ${task.completedAt}`,
          },
        ],
      };
    },
  );
}
