/**
 * Task Check Completion Individual Handler
 *
 * 個別タスクの完了状況をコードベースで確認
 * - Claude Sonnet でコードを読んで判定
 * - 詳細化 (Elaborate) と同じパターンで実装
 * - 結果は pending_completion_check に JSON で保存
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { CompletionCheckResult } from "@repo/types";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import type { JobResult } from "../worker.js";

/** ハンドラーパラメータ */
interface TaskCheckCompletionIndividualParams {
  taskId: number;
}

/**
 * 個別タスク完了チェックハンドラー
 */
export async function handleTaskCheckCompletionIndividual(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const { taskId } = params as unknown as TaskCheckCompletionIndividualParams;

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

  // プロジェクトパスがない場合はエラー
  if (!project?.path) {
    // エラー時もステータスを更新
    db.update(schema.tasks)
      .set({
        completionCheckStatus: "failed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    return {
      success: false,
      resultSummary: "プロジェクトパスが設定されていないため、コードベースを確認できません",
    };
  }

  try {
    // プロンプトを構築
    const systemPrompt = readFileSync(getPromptFilePath("task-completion-check"), "utf-8");

    let userPrompt = "# タスク情報\n\n";
    userPrompt += `**タイトル**: ${task.title}\n\n`;

    if (task.description) {
      userPrompt += `**説明**:\n${task.description}\n\n`;
    }

    userPrompt += `**プロジェクト**: ${project.name}\n`;
    userPrompt += `**プロジェクトパス**: ${project.path}\n\n`;

    userPrompt += "JSON 形式で出力してください。\n";

    // Claude を実行
    const cwd = project.path;
    const allowedTools = "Glob,Grep,Read";

    consola.info(
      `[task-check-completion-individual] Starting check for task ${taskId} (cwd: ${cwd})`,
    );

    const response = await runClaude(userPrompt, {
      model: "sonnet",
      systemPrompt,
      allowedTools,
      cwd,
    });

    // 結果を解析
    const result = parseCompletionCheckResponse(response);

    // 参照ファイルを追記 (Claude の出力に含まれていない場合)
    if (result.referencedFiles?.length === 0) {
      const fileRefs = extractReferencedFiles(response);
      result.referencedFiles = Array.from(fileRefs);
    }

    // タスクの pending_completion_check を更新
    db.update(schema.tasks)
      .set({
        completionCheckStatus: "completed",
        pendingCompletionCheck: JSON.stringify(result),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    consola.success(
      `[task-check-completion-individual] Done (completed: ${result.completed}, confidence: ${result.confidence})`,
    );

    return {
      success: true,
      resultSummary: result.completed
        ? `完了と判定 (確信度: ${Math.round(result.confidence * 100)}%)`
        : `未完了と判定 (確信度: ${Math.round(result.confidence * 100)}%)`,
      data: {
        taskId,
        completed: result.completed,
        confidence: result.confidence,
        referencedFilesCount: result.referencedFiles?.length ?? 0,
      },
    };
  } catch (error) {
    consola.error(`[task-check-completion-individual] Failed:`, error);

    // エラー時もステータスを更新
    db.update(schema.tasks)
      .set({
        completionCheckStatus: "failed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    return {
      success: false,
      resultSummary: error instanceof Error ? error.message : "完了チェックに失敗しました",
    };
  }
}

/**
 * Claude の応答から CompletionCheckResult を解析
 */
function parseCompletionCheckResponse(response: string): CompletionCheckResult {
  // JSON を抽出 (コードブロックに囲まれている場合も考慮)
  let jsonStr = response.trim();

  // ```json ... ``` を除去
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch?.[1]) {
    jsonStr = jsonBlockMatch[1].trim();
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
    const parsed = JSON.parse(jsonStr) as Partial<CompletionCheckResult>;

    return {
      completed: parsed.completed ?? false,
      confidence: parsed.confidence ?? 0.5,
      reason: parsed.reason ?? "判定理由が取得できませんでした",
      evidence: parsed.evidence,
      referencedFiles: parsed.referencedFiles ?? [],
    };
  } catch {
    // JSON パースに失敗した場合、デフォルト値を返す
    consola.warn("[task-check-completion-individual] Failed to parse JSON response");
    return {
      completed: false,
      confidence: 0.3,
      reason: "レスポンスの解析に失敗しました",
      evidence: response.slice(0, 500),
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
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      const path = match[1]?.trim();
      if (path && !path.includes("*")) {
        referencedFiles.add(path);
      }
    }
  }

  // ファイルパスパターンから抽出
  const fileMatches = response.matchAll(filePathPattern);
  for (const match of fileMatches) {
    referencedFiles.add(match[0]);
  }

  return referencedFiles;
}
