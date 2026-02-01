/**
 * タスク階層 (親子関係) のヘルパー関数
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { Task, TaskStatus } from "@repo/types";
import { asc, eq } from "drizzle-orm";

/**
 * タスクとその子タスクを取得
 * @param db データベース
 * @param taskId タスクID
 * @returns タスクと子タスクの配列、タスクが見つからない場合は null
 */
export function getTaskWithChildren(
  db: AdasDatabase,
  taskId: number,
): { task: Task; children: Task[] } | null {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();

  if (!task) {
    return null;
  }

  const children = db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.parentId, taskId))
    .orderBy(asc(schema.tasks.stepNumber))
    .all();

  return { task: task as Task, children: children as Task[] };
}

/**
 * タスクの親タスクを取得
 * @param db データベース
 * @param task タスク (parentId が設定されている必要がある)
 * @returns 親タスク、親がない場合は null
 */
export function getParentTask(db: AdasDatabase, task: { parentId: number | null }): Task | null {
  if (!task.parentId) {
    return null;
  }

  const parent = db.select().from(schema.tasks).where(eq(schema.tasks.id, task.parentId)).get();

  return parent ? (parent as Task) : null;
}

/**
 * タスクの子タスクを取得
 * @param db データベース
 * @param taskId 親タスクID
 * @returns 子タスクの配列 (stepNumber順)
 */
export function getChildTasks(db: AdasDatabase, taskId: number): Task[] {
  return db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.parentId, taskId))
    .orderBy(asc(schema.tasks.stepNumber))
    .all() as Task[];
}

/**
 * ステータスを日本語ラベルに変換
 */
function statusToLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    pending: "pending",
    accepted: "accepted",
    rejected: "rejected",
    in_progress: "in_progress",
    paused: "paused",
    completed: "completed",
  };
  return labels[status] || status;
}

interface FormatTaskHierarchyOptions {
  /** インデント文字 (デフォルト: "  ") */
  indent?: string;
  /** ステータスを表示するか (デフォルト: true) */
  showStatus?: boolean;
  /** 説明を表示するか (デフォルト: false) */
  showDescription?: boolean;
  /** 説明の最大長 (デフォルト: 50) */
  descriptionMaxLength?: number;
}

/**
 * タスクを階層表示用にフォーマット
 *
 * @example
 * 親タスクと子タスクの場合:
 * - 認証機能を実装する (認証機能の実装...)
 *   - Step 1: ログインフォーム作成 [completed]
 *   - Step 2: API実装 [in_progress]
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: タスク階層表示のロジック
export function formatTaskHierarchy(
  tasks: Task[],
  db: AdasDatabase,
  options: FormatTaskHierarchyOptions = {},
): string {
  const {
    indent = "  ",
    showStatus = true,
    showDescription = false,
    descriptionMaxLength = 50,
  } = options;

  const lines: string[] = [];

  // 親タスクと単独タスクを分離
  const parentTasks = tasks.filter(
    (t) => !t.parentId && tasks.some((child) => child.parentId === t.id),
  );
  const standaloneTasks = tasks.filter(
    (t) => !t.parentId && !tasks.some((child) => child.parentId === t.id),
  );
  const childTasks = tasks.filter((t) => t.parentId !== null);

  // 親タスクを処理 (子タスクは親の下にインデントして表示)
  for (const parent of parentTasks) {
    let line = `- ${parent.title}`;
    if (showDescription && parent.description) {
      const desc =
        parent.description.length > descriptionMaxLength
          ? `${parent.description.slice(0, descriptionMaxLength)}...`
          : parent.description;
      line += ` (${desc})`;
    }
    lines.push(line);

    // この親の子タスクを取得
    const children = getChildTasks(db, parent.id);
    for (const child of children) {
      const statusLabel = showStatus ? ` [${statusToLabel(child.status)}]` : "";
      lines.push(`${indent}- Step ${child.stepNumber}: ${child.title}${statusLabel}`);
    }
  }

  // 単独タスク (子タスクを持たない親なしタスク)
  for (const task of standaloneTasks) {
    let line = `- ${task.title}`;
    if (showDescription && task.description) {
      const desc =
        task.description.length > descriptionMaxLength
          ? `${task.description.slice(0, descriptionMaxLength)}...`
          : task.description;
      line += ` (${desc})`;
    }
    lines.push(line);
  }

  // 親が渡されていない子タスク (単独で表示)
  const orphanChildren = childTasks.filter((c) => !parentTasks.some((p) => p.id === c.parentId));
  for (const child of orphanChildren) {
    const statusLabel = showStatus ? ` [${statusToLabel(child.status)}]` : "";
    lines.push(`${indent}- Step ${child.stepNumber}: ${child.title}${statusLabel}`);
  }

  return lines.join("\n");
}

/**
 * 子タスク情報を完了判定リクエスト用にフォーマット
 */
export function formatChildTasksForCompletion(
  children: Task[],
): { stepNumber: number; title: string; status: TaskStatus }[] {
  return children.map((child) => ({
    stepNumber: child.stepNumber ?? 0,
    title: child.title,
    status: child.status,
  }));
}

/**
 * 子タスク情報をプロンプト用テキストにフォーマット
 */
export function formatChildTasksForPrompt(children: Task[]): string {
  if (children.length === 0) {
    return "";
  }

  const lines = [`\n### 子タスク (${children.length}件)`];
  for (const child of children) {
    const statusLabel = statusToLabel(child.status);
    lines.push(`${child.stepNumber ?? 0}. [${statusLabel}] ${child.title}`);
  }
  return lines.join("\n");
}
