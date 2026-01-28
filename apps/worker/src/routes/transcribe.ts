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

      // embeddings は任意
      let embeddings: Record<string, number[]> | undefined;
      const embeddingsStr = body.embeddings;
      if (typeof embeddingsStr === "string" && embeddingsStr.trim()) {
        embeddings = JSON.parse(embeddingsStr) as Record<string, number[]>;
      }

      // 一時ファイルに保存
      if (!existsSync(TMP_DIR)) {
        mkdirSync(TMP_DIR, { recursive: true });
      }
      const tmpPath = join(TMP_DIR, `${crypto.randomUUID()}.wav`);
      const arrayBuf = await audioFile.arrayBuffer();
      await Bun.write(tmpPath, arrayBuf);

      // 一時 embeddings ファイル(指定された場合)
      let tmpEmbeddingsPath: string | undefined;
      if (embeddings && Object.keys(embeddings).length > 0) {
        tmpEmbeddingsPath = join(TMP_DIR, `${crypto.randomUUID()}_embeddings.json`);
        await Bun.write(tmpEmbeddingsPath, JSON.stringify(embeddings));
      }

      try {
        const result = await runWhisperX(tmpPath, config, tmpEmbeddingsPath);
        return c.json(result);
      } finally {
        // 一時ファイル削除
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        if (tmpEmbeddingsPath) {
          try {
            unlinkSync(tmpEmbeddingsPath);
          } catch {
            /* ignore */
          }
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
  embeddingsPath?: string,
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

  if (embeddingsPath) {
    args.push("--embeddings-path", embeddingsPath);
  }

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (config.hfToken) {
    env.HF_TOKEN = config.hfToken;
  }

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
    segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
    speaker_embeddings?: Record<string, number[]>;
  }

  const json = JSON.parse(jsonStr) as WhisperXOutput;

  return {
    text: json.text,
    segments: json.segments.map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
      speaker: seg.speaker,
    })),
    language: json.language,
    speakerEmbeddings: json.speaker_embeddings,
  };
}
