import { unlinkSync } from "node:fs";
import consola from "consola";

/**
 * WebM (Opus) ファイルを WAV (16kHz, mono) に変換する。
 * Whisper への入力として使用する。
 */
export async function convertWebmToWav(
  inputPath: string,
  outputPath: string,
  options?: {
    sampleRate?: number;
    channels?: number;
    deleteInput?: boolean;
  },
): Promise<void> {
  const sampleRate = options?.sampleRate ?? 16000;
  const channels = options?.channels ?? 1;

  const args = [
    "ffmpeg",
    "-y", // 上書き確認なし
    "-i",
    inputPath,
    "-ar",
    String(sampleRate),
    "-ac",
    String(channels),
    "-acodec",
    "pcm_s16le", // 16-bit PCM
    outputPath,
  ];

  consola.debug(`Converting WebM to WAV: ${inputPath} -> ${outputPath}`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg conversion failed (exit code ${exitCode}): ${stderr}`);
  }

  consola.debug(`Converted successfully: ${outputPath}`);

  if (options?.deleteInput) {
    try {
      unlinkSync(inputPath);
      consola.debug(`Deleted input file: ${inputPath}`);
    } catch (err) {
      consola.warn(`Failed to delete input file: ${inputPath}`, err);
    }
  }
}
