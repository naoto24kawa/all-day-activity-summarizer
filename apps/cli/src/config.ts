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
  slack: {
    enabled: boolean;
    xoxcToken?: string;
    xoxdToken?: string;
    fetchIntervalMinutes: number;
    parallelWorkers: number;
    channels: string[]; // Channel IDs to monitor
    mentionGroups: string[]; // Group names to monitor (e.g., "team_製品開発本部_ジョブアンテナ")
    watchKeywords: string[]; // Keywords to monitor (e.g., "ジョブアンテナ", "障害")
  };
  claudeCode: {
    enabled: boolean;
    fetchIntervalMinutes: number;
    parallelWorkers: number;
    projects: string[]; // Project paths to monitor (empty = all)
  };
  speaker: {
    similarityThreshold: number; // 話者照合の閾値 (0.0-1.0, デフォルト 0.6)
    mergeAcrossChunks: boolean; // チャンク間での話者統合を有効にする
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
    chunkDurationMinutes: 2,
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
  slack: {
    enabled: false,
    xoxcToken: undefined,
    xoxdToken: undefined,
    fetchIntervalMinutes: 5,
    parallelWorkers: 3,
    channels: [],
    mentionGroups: [],
    watchKeywords: [],
  },
  claudeCode: {
    enabled: false,
    fetchIntervalMinutes: 5,
    parallelWorkers: 2,
    projects: [],
  },
  speaker: {
    similarityThreshold: 0.6,
    mergeAcrossChunks: true,
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

  // Deep merge nested config objects
  return {
    ...defaultConfig,
    ...userConfig,
    whisper: { ...defaultConfig.whisper, ...userConfig.whisper },
    audio: { ...defaultConfig.audio, ...userConfig.audio },
    server: { ...defaultConfig.server, ...userConfig.server },
    evaluator: { ...defaultConfig.evaluator, ...userConfig.evaluator },
    worker: { ...defaultConfig.worker, ...userConfig.worker },
    promptImprovement: { ...defaultConfig.promptImprovement, ...userConfig.promptImprovement },
    slack: { ...defaultConfig.slack, ...userConfig.slack },
    claudeCode: { ...defaultConfig.claudeCode, ...userConfig.claudeCode },
    speaker: { ...defaultConfig.speaker, ...userConfig.speaker },
  };
}

export function saveConfig(config: AdasConfig): void {
  ensureAdasHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
