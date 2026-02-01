import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AdasConfig {
  recordingsDir: string;
  dbPath: string;
  whisper: {
    enabled: boolean;
    modelName: string;
    language: string;
    installDir: string;
    engine: "whisperx" | "whisper-cpp";
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
    userId?: string; // Your Slack user ID (e.g., "U12345678") for filtering your own messages
    fetchIntervalMinutes: number;
    parallelWorkers: number;
    channels: string[]; // Channel IDs to monitor
    excludeChannels: string[]; // Channel IDs to exclude (e.g., RSS feed channels)
    mentionGroups: string[]; // Group names to monitor (e.g., "team_製品開発本部_ジョブアンテナ")
    watchKeywords: string[]; // Keywords to monitor (e.g., "ジョブアンテナ", "障害")
  };
  claudeCode: {
    enabled: boolean;
    fetchIntervalMinutes: number;
    parallelWorkers: number;
    projects: string[]; // Project paths to monitor (empty = all)
  };
  github: {
    enabled: boolean; // GitHub 統合を有効にする
    username?: string; // Your GitHub username for filtering assigned issues/PRs
    fetchIntervalMinutes: number; // 取得間隔(分)
    parallelWorkers: number; // 並列ワーカー数
  };
  projects: {
    gitScanPaths: string[]; // 探索対象ディレクトリ: ["~/projects"]
    excludePatterns: string[]; // 除外パターン: ["node_modules", ".cache", ...]
  };
  summarizer: {
    provider: "claude" | "lmstudio";
    dailyScheduleHour: number; // Daily サマリ自動生成時間 (0-23)
    timesIntervalMinutes: number; // Times サマリ自動生成間隔 (分)。0 = 無効
    lmstudio: {
      url: string;
      model: string;
      timeout: number;
    };
  };
  taskElaboration: {
    defaultLevel: "light" | "standard" | "detailed";
  };
  rateLimit: {
    enabled: boolean;
    limits: {
      requestsPerMinute: number;
      requestsPerHour: number;
      requestsPerDay: number;
      tokensPerMinute: number;
      tokensPerHour: number;
      tokensPerDay: number;
    };
    priorityMultipliers: {
      high: number;
      medium: number;
      low: number;
      lowest: number;
    };
  };
}

const ADAS_HOME = join(homedir(), ".adas");
const CONFIG_PATH = join(ADAS_HOME, "config.json");

const defaultConfig: AdasConfig = {
  recordingsDir: join(ADAS_HOME, "recordings"),
  dbPath: join(ADAS_HOME, "adas.db"),
  whisper: {
    enabled: true,
    modelName: "ggml-large-v3-turbo-q5_0.bin",
    language: "ja",
    installDir: join(ADAS_HOME, "whisper.cpp"),
    engine: "whisperx",
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
    userId: undefined,
    fetchIntervalMinutes: 5,
    parallelWorkers: 3,
    channels: [],
    excludeChannels: [],
    mentionGroups: [],
    watchKeywords: [],
  },
  claudeCode: {
    enabled: false,
    fetchIntervalMinutes: 5,
    parallelWorkers: 2,
    projects: [],
  },
  github: {
    enabled: false,
    username: undefined,
    fetchIntervalMinutes: 10,
    parallelWorkers: 2,
  },
  projects: {
    gitScanPaths: [],
    excludePatterns: [
      "node_modules",
      ".cache",
      ".vscode",
      ".idea",
      "vendor",
      "dist",
      "build",
      "target",
      ".git",
      ".npm",
      ".pnpm",
      ".yarn",
      "__pycache__",
      ".venv",
      "venv",
    ],
  },
  summarizer: {
    provider: "claude",
    dailyScheduleHour: 23,
    timesIntervalMinutes: 0, // 0 = 無効 (手動生成のみ)
    lmstudio: {
      url: "http://192.168.1.17:1234",
      model: "",
      timeout: 300000,
    },
  },
  taskElaboration: {
    defaultLevel: "standard",
  },
  rateLimit: {
    enabled: true,
    limits: {
      requestsPerMinute: 50,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      tokensPerMinute: 40000,
      tokensPerHour: 400000,
      tokensPerDay: 2000000,
    },
    priorityMultipliers: {
      high: 1.2,
      medium: 1.0,
      low: 0.8,
      lowest: 0.6,
    },
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
    github: { ...defaultConfig.github, ...userConfig.github },
    projects: { ...defaultConfig.projects, ...userConfig.projects },
    summarizer: {
      ...defaultConfig.summarizer,
      ...userConfig.summarizer,
      lmstudio: { ...defaultConfig.summarizer.lmstudio, ...userConfig.summarizer?.lmstudio },
    },
    taskElaboration: { ...defaultConfig.taskElaboration, ...userConfig.taskElaboration },
    rateLimit: {
      ...defaultConfig.rateLimit,
      ...userConfig.rateLimit,
      limits: { ...defaultConfig.rateLimit.limits, ...userConfig.rateLimit?.limits },
      priorityMultipliers: {
        ...defaultConfig.rateLimit.priorityMultipliers,
        ...userConfig.rateLimit?.priorityMultipliers,
      },
    },
  };
}

export function saveConfig(config: AdasConfig): void {
  ensureAdasHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
