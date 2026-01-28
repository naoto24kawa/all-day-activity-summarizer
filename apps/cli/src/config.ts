import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AdasConfig {
  recordingsDir: string;
  dbPath: string;
  whisper: {
    modelName: string;
    language: string;
    installDir: string;
    engine: "whisperx" | "whisper-cpp";
    hfToken?: string;
  };
  audio: {
    sampleRate: number;
    channels: number;
    chunkDurationMinutes: number;
  };
  server: {
    port: number;
  };
  evaluator: {
    enabled: boolean;
    autoApplyPatterns: boolean;
  };
  worker: {
    url: string;
    timeout: number;
  };
  promptImprovement: {
    enabled: boolean;
    badFeedbackThreshold: number;
  };
}

const ADAS_HOME = join(homedir(), ".adas");
const CONFIG_PATH = join(ADAS_HOME, "config.json");

const defaultConfig: AdasConfig = {
  recordingsDir: join(ADAS_HOME, "recordings"),
  dbPath: join(ADAS_HOME, "adas.db"),
  whisper: {
    modelName: "ggml-large-v3-turbo-q5_0.bin",
    language: "ja",
    installDir: join(ADAS_HOME, "whisper.cpp"),
    engine: "whisperx",
    hfToken: undefined,
  },
  audio: {
    sampleRate: 16000,
    channels: 1,
    chunkDurationMinutes: 5,
  },
  server: {
    port: 3001,
  },
  evaluator: {
    enabled: true,
    autoApplyPatterns: true,
  },
  worker: {
    url: "http://localhost:3100",
    timeout: 300000,
  },
  promptImprovement: {
    enabled: false,
    badFeedbackThreshold: 5,
  },
};

export function getAdasHome(): string {
  return ADAS_HOME;
}

export function ensureAdasHome(): void {
  if (!existsSync(ADAS_HOME)) {
    mkdirSync(ADAS_HOME, { recursive: true });
  }
}

export function loadConfig(): AdasConfig {
  ensureAdasHome();

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const userConfig = JSON.parse(raw) as Partial<AdasConfig>;
  return { ...defaultConfig, ...userConfig };
}

export function saveConfig(config: AdasConfig): void {
  ensureAdasHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
