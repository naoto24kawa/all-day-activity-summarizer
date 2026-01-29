import { unlinkSync } from "node:fs";
import consola from "consola";

/**
 * ffprobe を使って WebM ファイルの整合性をチェックする。
 * 破損したファイル(EBMLヘッダーが不完全など)を検出する。
 */
async function isValidWebm(inputPath: string): Promise<boolean> {
  const args = [
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "csv=p=0",
    inputPath,
  ];

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

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

  // 破損チェック: ffprobe でファイルの整合性を確認
  const isValid = await isValidWebm(inputPath);
  if (!isValid) {
    consola.warn(`Skipping corrupted WebM file: ${inputPath}`);
    // 破損ファイルを削除(オプションで指定されている場合)
    if (options?.deleteInput) {
      try {
        unlinkSync(inputPath);
        consola.debug(`Deleted corrupted input file: ${inputPath}`);
      } catch (err) {
        consola.warn(`Failed to delete corrupted input file: ${inputPath}`, err);
      }
    }
    throw new Error(`Corrupted WebM file (EBML header invalid): ${inputPath}`);
  }

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
