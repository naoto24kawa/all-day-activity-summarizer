/**
 * Claude Chat Handler
 *
 * Claude Code にタスク情報を送信して非同期で処理
 */

import { spawn } from "node:child_process";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import type { JobResult } from "../worker.js";

/** ハンドラーパラメータ */
interface ClaudeChatParams {
  taskId: number;
  prompt: string;
}

/**
 * Claude CLI を実行
 */
async function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--no-session-persistence", "--allowedTools", "Read,Glob,Grep"];

    const proc = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Claude Chat ハンドラー
 */
export async function handleClaudeChat(
  db: AdasDatabase,
  _config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const { taskId, prompt } = params as unknown as ClaudeChatParams;

  if (!prompt) {
    return {
      success: false,
      resultSummary: "プロンプトが指定されていません",
    };
  }

  try {
    consola.info(`[claude-chat] Starting chat for task ${taskId ?? "unknown"}`);

    const response = await runClaude(prompt);

    // タスクIDが指定されていればメモとして保存
    if (taskId) {
      const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      if (task) {
        // レスポンスの要約 (最初の200文字)
        const summary = response.slice(0, 200) + (response.length > 200 ? "..." : "");
        consola.info(`[claude-chat] Response summary: ${summary}`);
      }
    }

    consola.success(`[claude-chat] Done (${response.length} chars)`);

    return {
      success: true,
      resultSummary: `Claude 応答完了 (${response.length} 文字)`,
      data: {
        taskId,
        response,
        responseLength: response.length,
      },
    };
  } catch (error) {
    consola.error(`[claude-chat] Failed:`, error);

    return {
      success: false,
      resultSummary: error instanceof Error ? error.message : "Claude Chat に失敗しました",
    };
  }
}
