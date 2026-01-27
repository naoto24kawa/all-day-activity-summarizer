import consola from "consola";
import type { AdasConfig } from "../config.js";
import { getModelPath, getWhisperBinaryPath, isWhisperInstalled } from "./setup.js";

export interface WhisperSegment {
  start: number; // ms
  end: number; // ms
  text: string;
}

interface WhisperJsonOutput {
  transcription: Array<{
    timestamps: { from: string; to: string };
    offsets: { from: number; to: number };
    text: string;
  }>;
}

export interface WhisperResult {
  text: string;
  segments: WhisperSegment[];
  language: string;
}

export async function transcribeAudio(
  audioPath: string,
  config: AdasConfig,
): Promise<WhisperResult> {
  if (!isWhisperInstalled(config)) {
    throw new Error("whisper.cpp is not installed. Run 'adas setup' first.");
  }

  const binaryPath = getWhisperBinaryPath(config);
  const modelPath = getModelPath(config);

  consola.debug(`Transcribing: ${audioPath}`);

  const proc = Bun.spawn(
    [
      binaryPath,
      "-m",
      modelPath,
      "-f",
      audioPath,
      "-l",
      config.whisper.language,
      "--output-json",
      "--no-prints",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderrStream = proc.stderr;
    const stderr =
      stderrStream && typeof stderrStream !== "number"
        ? await new Response(stderrStream).text()
        : "";
    throw new Error(`whisper.cpp failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  }

  const json = JSON.parse(stdout) as WhisperJsonOutput;

  const segments: WhisperSegment[] = json.transcription.map((seg) => ({
    start: seg.offsets.from,
    end: seg.offsets.to,
    text: seg.text.trim(),
  }));

  const fullText = segments.map((s) => s.text).join(" ");

  return {
    text: fullText,
    segments,
    language: config.whisper.language,
  };
}
