import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** LLM プロバイダーの種類 */
export type LLMProviderType = "claude" | "lmstudio";

/** 各処理ごとの LLM プロバイダー設定 */
export interface AIProviderConfig {
  /** LM Studio の接続設定 */
  lmstudio: {
    url: string;
    model: string;
    timeout: number;
  };
  /** 各処理で使用する provider (未指定は claude) */
  providers: {
    /** サマリ生成 (times/daily) */
    summarize: LLMProviderType;
    /** メモタグ提案 */
    suggestTags: LLMProviderType;
    /** ハルシネーション評価 */
    evaluate: LLMProviderType;
    /** 音声テキスト解釈 */
    interpret: LLMProviderType;
    /** タスク完了判定 */
    checkCompletion: LLMProviderType;
    /** プロフィール分析 */
    analyzeProfile: LLMProviderType;
    /** 学び抽出 */
    extractLearnings: LLMProviderType;
    /** タスク抽出 */
    taskExtract: LLMProviderType;
    /** 読み生成 (Kuromoji フォールバック用) */
    generateReadings: LLMProviderType;
  };
  /** フォールバック有効化 (LM Studio 失敗時に Claude へ) */
  enableFallback: boolean;
}

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
  localWorker: {
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
    priorityNotification: {
      enabled: boolean; // 優先度通知を有効にする
      terminalNotify: boolean; // ターミナルに通知を表示
      sseNotify: boolean; // SSE で通知を送信
      cooldownMinutes: number; // 同一スレッドの通知抑制時間 (分)
    };
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
  calendar: {
    enabled: boolean; // Google Calendar 統合を有効にする
    fetchIntervalMinutes: number; // 取得間隔 (分)
    credentialsPath: string; // OAuth 2.0 credentials.json のパス
    tokenPath: string; // 認証トークン保存先
    calendarIds: string[]; // 監視するカレンダーID (空 = プライマリのみ)
    daysToFetch: number; // 取得する日数 (過去から未来まで)
  };
  projects: {
    gitScanPaths: string[]; // 探索対象ディレクトリ: ["~/projects"]
    excludePatterns: string[]; // 除外パターン: ["node_modules", ".cache", ...]
  };
  /** AI プロバイダー設定 (Claude / LM Studio 切り替え) */
  aiProvider: AIProviderConfig;
  /** @deprecated summarizer.provider は aiProvider.providers.summarize に移行 */
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
  sseServer: {
    url: string;
    port: number;
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
  localWorker: {
    url: "http://localhost:3200",
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
    priorityNotification: {
      enabled: true,
      terminalNotify: true,
      sseNotify: true,
      cooldownMinutes: 5,
    },
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
  calendar: {
    enabled: false,
    fetchIntervalMinutes: 15,
    credentialsPath: join(ADAS_HOME, "credentials.json"),
    tokenPath: join(ADAS_HOME, "calendar-token.json"),
    calendarIds: [], // 空 = プライマリカレンダーのみ
    daysToFetch: 7, // 前後7日分を取得
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
  aiProvider: {
    lmstudio: {
      url: "http://192.168.1.17:1234",
      model: "",
      timeout: 300000,
    },
    providers: {
      summarize: "claude",
      suggestTags: "claude",
      evaluate: "claude",
      interpret: "claude",
      checkCompletion: "claude",
      analyzeProfile: "claude",
      extractLearnings: "claude",
      taskExtract: "claude",
      generateReadings: "lmstudio",
    },
    enableFallback: true,
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
  sseServer: {
    url: "http://localhost:3002",
    port: 3002,
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
    return applyEnvOverrides(defaultConfig);
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const userConfig = JSON.parse(raw) as Partial<AdasConfig>;

  // Deep merge nested config objects
  const merged: AdasConfig = {
    ...defaultConfig,
    ...userConfig,
    whisper: { ...defaultConfig.whisper, ...userConfig.whisper },
    audio: { ...defaultConfig.audio, ...userConfig.audio },
    server: { ...defaultConfig.server, ...userConfig.server },
    evaluator: { ...defaultConfig.evaluator, ...userConfig.evaluator },
    worker: { ...defaultConfig.worker, ...userConfig.worker },
    localWorker: { ...defaultConfig.localWorker, ...userConfig.localWorker },
    promptImprovement: { ...defaultConfig.promptImprovement, ...userConfig.promptImprovement },
    slack: {
      ...defaultConfig.slack,
      ...userConfig.slack,
      priorityNotification: {
        ...defaultConfig.slack.priorityNotification,
        ...userConfig.slack?.priorityNotification,
      },
    },
    claudeCode: { ...defaultConfig.claudeCode, ...userConfig.claudeCode },
    github: { ...defaultConfig.github, ...userConfig.github },
    calendar: { ...defaultConfig.calendar, ...userConfig.calendar },
    projects: { ...defaultConfig.projects, ...userConfig.projects },
    aiProvider: {
      ...defaultConfig.aiProvider,
      ...userConfig.aiProvider,
      lmstudio: { ...defaultConfig.aiProvider.lmstudio, ...userConfig.aiProvider?.lmstudio },
      providers: { ...defaultConfig.aiProvider.providers, ...userConfig.aiProvider?.providers },
    },
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
    sseServer: { ...defaultConfig.sseServer, ...userConfig.sseServer },
  };

  return applyEnvOverrides(merged);
}

/**
 * 環境変数からトークン等を上書きする。
 * 環境変数が設定されていれば優先、なければ config.json の値を使用。
 */
function applyEnvOverrides(config: AdasConfig): AdasConfig {
  // Slack tokens: 環境変数 > config.json
  if (process.env.SLACK_XOXC_TOKEN) {
    config.slack.xoxcToken = process.env.SLACK_XOXC_TOKEN;
  }
  if (process.env.SLACK_XOXD_TOKEN) {
    config.slack.xoxdToken = process.env.SLACK_XOXD_TOKEN;
  }

  return config;
}

export function saveConfig(config: AdasConfig): void {
  ensureAdasHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
