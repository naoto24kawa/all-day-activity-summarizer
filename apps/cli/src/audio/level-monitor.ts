import type { Subprocess } from "bun";

interface LevelMonitorOptions {
  source: string;
  type: "mic" | "speaker";
  onLevel?: (level: number) => void;
}

/**
 * Monitors audio level in real-time using ffmpeg astats filter.
 * Returns RMS level in dB (typically -60 to 0, where 0 is max).
 */
export class AudioLevelMonitor {
  private process: Subprocess | null = null;
  private running = false;
  private readonly source: string;
  private readonly onLevel?: (level: number) => void;
  private currentLevel = -60;

  constructor(options: LevelMonitorOptions) {
    this.source = options.source;
    this.onLevel = options.onLevel;
  }

  isRunning(): boolean {
    return this.running;
  }

  getLevel(): number {
    return this.currentLevel;
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    const ffmpegArgs = this.buildFfmpegArgs();

    this.process = Bun.spawn(ffmpegArgs, {
      stdout: "pipe",
      stderr: "ignore",
    });

    // Parse stdout for audio levels (ametadata outputs to stdout via file=-)
    this.parseStdout();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.process) {
      this.process.kill("SIGINT");
      await this.process.exited;
      this.process = null;
    }
    this.currentLevel = -60;
  }

  private buildFfmpegArgs(): string[] {
    if (process.platform === "darwin") {
      const device = this.source === "default" ? ":0" : `:${this.source}`;
      return [
        "ffmpeg",
        "-f",
        "avfoundation",
        "-i",
        device,
        "-af",
        "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
        "-f",
        "null",
        "-",
      ];
    }

    // Linux (PulseAudio)
    return [
      "ffmpeg",
      "-f",
      "pulse",
      "-i",
      this.source,
      "-af",
      "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f",
      "null",
      "-",
    ];
  }

  private async parseStdout(): Promise<void> {
    const stdout = this.process?.stdout;
    if (!stdout || typeof stdout === "number") return;

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse RMS level from ffmpeg output
        // Format: lavfi.astats.Overall.RMS_level=-XX.XXXX
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const match = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/);
          if (match?.[1]) {
            const level = Number.parseFloat(match[1]);
            if (!Number.isNaN(level)) {
              this.currentLevel = Math.max(-60, Math.min(0, level));
              this.onLevel?.(this.currentLevel);
            }
          }
        }
      }
    } catch {
      // Process terminated
    }
  }
}

// Store active monitors
const monitors: Map<string, AudioLevelMonitor> = new Map();

export function getMonitor(type: "mic" | "speaker"): AudioLevelMonitor | undefined {
  return monitors.get(type);
}

export function setMonitor(type: "mic" | "speaker", monitor: AudioLevelMonitor): void {
  monitors.set(type, monitor);
}

export function removeMonitor(type: "mic" | "speaker"): void {
  monitors.delete(type);
}

export function getAllLevels(): { mic: number | null; speaker: number | null } {
  return {
    mic: monitors.get("mic")?.getLevel() ?? null,
    speaker: monitors.get("speaker")?.getLevel() ?? null,
  };
}
