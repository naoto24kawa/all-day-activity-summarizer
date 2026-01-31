/**
 * Task Elaborate Handler
 *
 * タスクの詳細化を非同期で実行
 * - Claude Sonnet でコードベースを確認しながら詳細化
 * - 親タスクの説明 + 子タスク (実装ステップ) を生成
 * - 結果は pending_elaboration に JSON で保存
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { ElaborationResult } from "@repo/types";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import type { JobResult } from "../worker.js";

/** ハンドラーパラメータ */
interface TaskElaborateParams {
  taskId: number;
  userInstruction?: string;
}

/**
 * タスク詳細化ハンドラー
 */
export async function handleTaskElaborate(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const { taskId, userInstruction } = params as TaskElaborateParams;

  if (!taskId) {
    return {
      success: false,
      resultSummary: "タスクIDが指定されていません",
    };
  }

  // タスクを取得
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();

  if (!task) {
    return {
      success: false,
      resultSummary: `タスクが見つかりません: ${taskId}`,
    };
  }

  // プロジェクト情報を取得
  let project: { id: number; name: string; path: string | null } | undefined;
  if (task.projectId) {
    project = db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        path: schema.projects.path,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))
      .get();
  }

  try {
    // プロンプトを構築
    const systemPrompt = readFileSync(getPromptFilePath("task-elaborate"), "utf-8");

    let userPrompt = "# タスク情報\n\n";
    userPrompt += `**タイトル**: ${task.title}\n\n`;

    if (task.description) {
      userPrompt += `**現在の説明**:\n${task.description}\n\n`;
    }

    if (project) {
      userPrompt += `**プロジェクト**: ${project.name}\n`;
      if (project.path) {
        userPrompt += `**プロジェクトパス**: ${project.path}\n\n`;
      } else {
        userPrompt += "\n(プロジェクトパスが未設定のため、コードベースは参照できません)\n\n";
      }
    } else {
      userPrompt += "(プロジェクト未設定)\n\n";
    }

    if (userInstruction) {
      userPrompt += `**追加の指示**:\n${userInstruction}\n\n`;
    }

    userPrompt += "JSON 形式で出力してください。\n";

    // Claude を実行
    const cwd = project?.path ?? undefined;
    const allowedTools = cwd ? "Glob,Grep,Read" : undefined;
    const disableTools = !cwd;

    consola.info(
      `[task-elaborate] Starting elaboration for task ${taskId} (cwd: ${cwd ?? "none"})`,
    );

    const response = await runClaude(userPrompt, {
      model: "sonnet",
      systemPrompt,
      allowedTools,
      disableTools,
      cwd,
    });

    // 結果を解析
    const result = parseElaborationResponse(response);

    // 参照ファイルを追記 (Claude の出力に含まれていない場合)
    if (cwd && result.referencedFiles.length === 0) {
      // レスポンスからファイルパスを抽出
      const fileRefs = extractReferencedFiles(response);
      result.referencedFiles = Array.from(fileRefs);
    }

    // タスクの pending_elaboration を更新
    db.update(schema.tasks)
      .set({
        elaborationStatus: "completed",
        pendingElaboration: JSON.stringify(result),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    consola.success(
      `[task-elaborate] Done (${result.childTasks.length} child tasks, ${result.referencedFiles.length} files)`,
    );

    return {
      success: true,
      resultSummary: `詳細化完了: ${result.childTasks.length} 件の子タスクを生成`,
      data: {
        taskId,
        childTaskCount: result.childTasks.length,
        referencedFilesCount: result.referencedFiles.length,
      },
    };
  } catch (error) {
    consola.error(`[task-elaborate] Failed:`, error);

    // エラー時もステータスを更新
    db.update(schema.tasks)
      .set({
        elaborationStatus: "failed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    return {
      success: false,
      resultSummary: error instanceof Error ? error.message : "詳細化に失敗しました",
    };
  }
}

/**
 * Claude の応答から ElaborationResult を解析
 */
function parseElaborationResponse(response: string): ElaborationResult {
  // JSON を抽出 (コードブロックに囲まれている場合も考慮)
  let jsonStr = response.trim();

  // ```json ... ``` を除去
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1]!.trim();
  }

  // JSON の開始位置を見つける
  const jsonStartIndex = jsonStr.indexOf("{");
  if (jsonStartIndex > 0) {
    jsonStr = jsonStr.slice(jsonStartIndex);
  }

  // JSON の終了位置を見つける (最後の } を探す)
  const jsonEndIndex = jsonStr.lastIndexOf("}");
  if (jsonEndIndex > 0 && jsonEndIndex < jsonStr.length - 1) {
    jsonStr = jsonStr.slice(0, jsonEndIndex + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr) as Partial<ElaborationResult>;

    return {
      elaboration: parsed.elaboration ?? "",
      childTasks: (parsed.childTasks ?? []).map((ct, index) => ({
        title: ct.title ?? `ステップ ${index + 1}`,
        description: ct.description ?? null,
        stepNumber: ct.stepNumber ?? index + 1,
      })),
      referencedFiles: parsed.referencedFiles ?? [],
    };
  } catch {
    // JSON パースに失敗した場合、レスポンス全体を elaboration として扱う
    consola.warn("[task-elaborate] Failed to parse JSON, using raw response");
    return {
      elaboration: response,
      childTasks: [],
      referencedFiles: [],
    };
  }
}

/**
 * レスポンスからファイルパスを抽出
 */
function extractReferencedFiles(response: string): Set<string> {
  const referencedFiles = new Set<string>();

  // Read/Glob/Grep ツールの使用を検出
  const readPattern = /Read\s+file:\s*([^\n]+)/g;
  const globPattern = /Glob\s+pattern:\s*([^\n]+)/g;
  const grepPattern = /Grep\s+(?:pattern|in):\s*([^\n]+)/g;
  const filePathPattern = /(?:src|apps|packages|lib)\/[\w/-]+\.\w+/g;

  // ツール使用パターンから抽出
  for (const pattern of [readPattern, globPattern, grepPattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(response)) !== null) {
      const path = match[1]?.trim();
      if (path && !path.includes("*")) {
        referencedFiles.add(path);
      }
    }
  }

  // ファイルパスパターンから抽出
  let match: RegExpExecArray | null;
  while ((match = filePathPattern.exec(response)) !== null) {
    referencedFiles.add(match[0]);
  }

  return referencedFiles;
}
