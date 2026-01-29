import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getScriptPath } from "@repo/core";
import type { RpcTranscribeConfig, RpcTranscribeResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";

const WHISPERX_VENV_DIR = join(homedir(), ".adas", "whisperx-venv");
const TMP_DIR = join(homedir(), ".adas", "worker-tmp");

export function createTranscribeRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.parseBody();

      const audioFile = body.audio;
      if (!(audioFile instanceof File)) {
        return c.json({ error: "audio file is required" }, 400);
      }

      const configStr = body.config;
      if (typeof configStr !== "string") {
        return c.json({ error: "config JSON is required" }, 400);
      }

      const config = JSON.parse(configStr) as RpcTranscribeConfig;

      // 一時ファイルに保存
      if (!existsSync(TMP_DIR)) {
        mkdirSync(TMP_DIR, { recursive: true });
      }
      const tmpPath = join(TMP_DIR, `${crypto.randomUUID()}.wav`);
      const arrayBuf = await audioFile.arrayBuffer();
      await Bun.write(tmpPath, arrayBuf);

      try {
        const result = await runWhisperX(tmpPath, config);
        return c.json(result);
      } finally {
        // 一時ファイル削除
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      consola.error("[worker/transcribe] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function runWhisperX(
  audioPath: string,
  config: RpcTranscribeConfig,
): Promise<RpcTranscribeResponse> {
  const pythonPath = join(WHISPERX_VENV_DIR, "bin", "python3");
  if (!existsSync(pythonPath)) {
    throw new Error("whisperX is not installed on this worker");
  }

  // @repo/core から Python スクリプトのパスを取得
  const scriptPath = getScriptPath("whisperx_transcribe.py");

  if (!existsSync(scriptPath)) {
    throw new Error(`whisperX script not found: ${scriptPath}`);
  }

  const args = [pythonPath, scriptPath, audioPath, "--language", config.language];

  // initial_prompt を追加(存在する場合)
  if (config.initialPrompt) {
    args.push("--initial-prompt", config.initialPrompt);
  }

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  // HF_TOKEN は diarization 用なので削除

  consola.info(`[worker/transcribe] Running whisperX on ${audioPath}`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  await proc.exited;

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";
    throw new Error(`whisperX failed (exit ${proc.exitCode}): ${stderr.slice(0, 500)}`);
  }

  const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";

  if (!stdout.trim()) {
    throw new Error("whisperX returned empty output");
  }

  // JSON を抽出
  const jsonStart = stdout.indexOf("{");
  const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;

  interface WhisperXOutput {
    text: string;
    language: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }

  const json = JSON.parse(jsonStr) as WhisperXOutput;

  return {
    text: json.text,
    segments: json.segments.map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    })),
    language: json.language,
  };
}
