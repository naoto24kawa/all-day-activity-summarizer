import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";

interface CaptureOptions {
  source?: string;
  config: AdasConfig;
  onChunkComplete?: (filePath: string) => void;
}

function getDateDir(baseDir: string): string {
  return join(baseDir, getTodayDateString());
}

function getChunkFileName(): string {
  const now = new Date();
  const time = now.toTimeString().split(" ")[0]?.replace(/:/g, "-");
  return `chunk_${time}.wav`;
}

export async function listPulseAudioSources(): Promise<string[]> {
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
  private readonly onChunkComplete?: (filePath: string) => void;
  private currentFilePath: string | null = null;

  constructor(options: CaptureOptions) {
    this.config = options.config;
    this.source = options.source ?? "default";
    this.onChunkComplete = options.onChunkComplete;
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

    const fileName = getChunkFileName();
    this.currentFilePath = join(dateDir, fileName);
    const durationSec = this.config.audio.chunkDurationMinutes * 60;

    consola.debug(`Recording chunk: ${this.currentFilePath}`);

    this.process = Bun.spawn(
      [
        "ffmpeg",
        "-f",
        "pulse",
        "-i",
        this.source,
        "-ac",
        String(this.config.audio.channels),
        "-ar",
        String(this.config.audio.sampleRate),
        "-t",
        String(durationSec),
        "-y",
        this.currentFilePath,
      ],
      {
        stdout: "ignore",
        stderr: "pipe",
      },
    );

    // Wait for ffmpeg to finish the chunk, then start next
    this.process.exited.then(async (exitCode) => {
      const completedPath = this.currentFilePath;

      if (exitCode === 0 && completedPath) {
        consola.success(`Chunk saved: ${completedPath}`);
        this.onChunkComplete?.(completedPath);
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

  private async stopCurrentProcess(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGINT");
      await this.process.exited;

      if (this.currentFilePath) {
        consola.info(`Final chunk saved: ${this.currentFilePath}`);
        this.onChunkComplete?.(this.currentFilePath);
      }

      this.process = null;
      this.currentFilePath = null;
    }
  }
}
