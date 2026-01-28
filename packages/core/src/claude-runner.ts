import { spawn } from "node:child_process";
import { join } from "node:path";
import consola from "consola";

export interface RunClaudeOptions {
  model?: string;
  systemPrompt?: string;
  appendSystemPromptFile?: string;
  allowedTools?: string;
  disableTools?: boolean;
  dangerouslySkipPermissions?: boolean;
  cwd?: string;
}

/**
 * packages/core/prompts/ 配下のプロンプトファイルの絶対パスを返す。
 */
export function getPromptFilePath(name: string): string {
  return join(import.meta.dirname, "../prompts", `${name}.md`);
}

/**
 * Claude Code CLI を `claude -p` で呼び出してテキスト結果を返す。
 */
export async function runClaude(prompt: string, options?: RunClaudeOptions): Promise<string> {
  const args = ["-p", prompt, "--no-session-persistence"];

  if (options?.model) {
    args.push("--model", options.model);
  }

  if (options?.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  if (options?.appendSystemPromptFile) {
    args.push("--append-system-prompt-file", options.appendSystemPromptFile);
  }

  if (options?.disableTools) {
    args.push("--tools=");
  } else if (options?.allowedTools) {
    args.push("--allowedTools", options.allowedTools);
  }

  if (options?.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  const model = options?.model ?? "default";
  consola.info(
    `[claude-runner] Starting claude (model: ${model}), args: ${JSON.stringify(args.slice(0, 4))}...`,
  );

  const startTime = Date.now();

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (code !== 0) {
        consola.warn(`[claude-runner] Failed (${elapsed}s, exit ${code})`);
        consola.warn(`[claude-runner] stderr: ${stderr || "(empty)"}`);
        consola.warn(`[claude-runner] stdout: ${stdout.slice(0, 500) || "(empty)"}`);
        reject(new Error(`claude exited with code ${code}: ${stderr || stdout.slice(0, 200)}`));
        return;
      }
      consola.success(`[claude-runner] Done (${elapsed}s, ${stdout.length} chars)`);
      resolve(stdout.trim());
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}
