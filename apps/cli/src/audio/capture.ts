import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";

interface CaptureOptions {
  source?: string;
  sourceType?: "mic" | "speaker";
  config: AdasConfig;
  onChunkComplete?: (filePath: string) => void;
}

function getDateDir(baseDir: string): string {
  return join(baseDir, getTodayDateString());
}

function getChunkFileName(sourceType?: string): string {
  const now = new Date();
  const time = now.toTimeString().split(" ")[0]?.replace(/:/g, "-");
  const suffix = sourceType ? `_${sourceType}` : "";
  return `chunk_${time}${suffix}.wav`;
}

export async function listAudioSources(): Promise<string[]> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    const lines = stderr.split("\n");
    const sources: string[] = [];
    let inAudio = false;
    for (const line of lines) {
      if (line.includes("AVFoundation audio devices:")) {
        inAudio = true;
        continue;
      }
      if (inAudio) {
        const match = line.match(/\[(\d+)]\s+(.+)/);
        if (match) {
          sources.push(`${match[1]}: ${match[2]}`);
        }
      }
    }
    return sources;
  }

  // Linux (PulseAudio)
  const proc = Bun.spawn(["pactl", "list", "short", "sources"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  return output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split("\t");
      return parts[1] ?? line;
    });
}

export class AudioCapture {
  private process: Subprocess | null = null;
  private running = false;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: AdasConfig;
  private readonly source: string;
  private readonly sourceType?: "mic" | "speaker";
  private readonly onChunkComplete?: (filePath: string) => void;
  private currentFilePath: string | null = null;

  constructor(options: CaptureOptions) {
    this.config = options.config;
    this.source = options.source ?? "default";
    this.sourceType = options.sourceType;
    this.onChunkComplete = options.onChunkComplete;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      consola.warn("Audio capture is already running");
      return;
    }

    this.running = true;
    consola.info(`Audio capture started (source: ${this.source})`);
    await this.startChunk();
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    await this.stopCurrentProcess();
    consola.info("Audio capture stopped");
  }

  private async startChunk(): Promise<void> {
    if (!this.running) return;

    const dateDir = getDateDir(this.config.recordingsDir);
    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true });
    }

    const fileName = getChunkFileName(this.sourceType);
    this.currentFilePath = join(dateDir, fileName);
    const durationSec = this.config.audio.chunkDurationMinutes * 60;

    consola.debug(`Recording chunk: ${this.currentFilePath}`);

    const ffmpegArgs = this.buildFfmpegArgs(durationSec);

    this.process = Bun.spawn(ffmpegArgs, {
      stdout: "ignore",
      stderr: "pipe",
    });

    // Wait for ffmpeg to finish the chunk, then start next
    this.process.exited.then(async (exitCode) => {
      const completedPath = this.currentFilePath;

      if (exitCode === 0 && completedPath && existsSync(completedPath)) {
        consola.success(`Chunk saved: ${completedPath}`);
        this.onChunkComplete?.(completedPath);
      } else if (exitCode === 0 && completedPath && !existsSync(completedPath)) {
        consola.warn(`ffmpeg reported success but file not found: ${completedPath}`);
      } else if (this.running) {
        const stderrStream = this.process?.stderr;
        const stderr =
          stderrStream && typeof stderrStream !== "number"
            ? await new Response(stderrStream).text()
            : "";
        consola.warn(`ffmpeg exited with code ${exitCode}: ${stderr.slice(0, 200)}`);
      }

      if (this.running) {
        await this.startChunk();
      }
    });
  }

  private buildFfmpegArgs(durationSec: number): string[] {
    const output = this.currentFilePath ?? "";
    if (!output) {
      throw new Error("currentFilePath is not set");
    }
    const channels = String(this.config.audio.channels);
    const sampleRate = String(this.config.audio.sampleRate);

    if (process.platform === "darwin") {
      // avfoundation: source is ":deviceIndex" (audio-only)
      const device = this.source === "default" ? ":0" : `:${this.source}`;
      return [
        "ffmpeg",
        "-f",
        "avfoundation",
        "-i",
        device,
        "-ac",
        channels,
        "-ar",
        sampleRate,
        "-t",
        String(durationSec),
        "-y",
        output,
      ];
    }

    // Linux (PulseAudio)
    return [
      "ffmpeg",
      "-f",
      "pulse",
      "-i",
      this.source,
      "-ac",
      channels,
      "-ar",
      sampleRate,
      "-t",
      String(durationSec),
      "-y",
      output,
    ];
  }

  private async stopCurrentProcess(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGINT");
      await this.process.exited;

      if (this.currentFilePath && existsSync(this.currentFilePath)) {
        consola.info(`Final chunk saved: ${this.currentFilePath}`);
        this.onChunkComplete?.(this.currentFilePath);
      } else if (this.currentFilePath) {
        consola.warn(`Final chunk file not found: ${this.currentFilePath}`);
      }

      this.process = null;
      this.currentFilePath = null;
    }
  }
}
