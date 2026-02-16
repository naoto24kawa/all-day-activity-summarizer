import { spawn } from "node:child_process";
import consola from "consola";

export interface RunGeminiOptions {
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Gemini CLI を `gemini -p` で呼び出してテキスト結果を返す。
 * プロンプトは stdin 経由で渡すため、長いプロンプトでも E2BIG エラーが発生しない。
 */
export async function runGemini(prompt: string, options?: RunGeminiOptions): Promise<string> {
  const args = ["-p", ""];

  if (options?.model) {
    args.push("--model", options.model);
  }

  // システムプロンプトがある場合は、プロンプトの先頭に追加
  const finalPrompt = options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

  const model = options?.model ?? "default";
  consola.info(
    `[gemini-runner] Starting gemini (model: ${model}), prompt length: ${finalPrompt.length} chars`,
  );

  const startTime = Date.now();

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("gemini", args, {
      cwd: options?.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // プロンプトを stdin に書き込み
    proc.stdin.write(finalPrompt);
    proc.stdin.end();

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
        consola.warn(`[gemini-runner] Failed (${elapsed}s, exit ${code})`);
        consola.warn(`[gemini-runner] stderr: ${stderr || "(empty)"}`);
        consola.warn(`[gemini-runner] stdout: ${stdout.slice(0, 500) || "(empty)"}`);
        reject(new Error(`gemini exited with code ${code}: ${stderr || stdout.slice(0, 200)}`));
        return;
      }
      consola.success(`[gemini-runner] Done (${elapsed}s, ${stdout.length} chars)`);
      resolve(stdout.trim());
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn gemini: ${err.message}`));
    });
  });
}
