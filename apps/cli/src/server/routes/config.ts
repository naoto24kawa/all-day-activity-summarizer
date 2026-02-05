import { existsSync } from "node:fs";
import { Hono } from "hono";
import type { AdasConfig, AIProviderConfig, LLMProviderType } from "../../config.js";
import { loadConfig, saveConfig } from "../../config.js";

interface IntegrationsUpdateBody {
  whisper?: { enabled: boolean };
  slack?: { enabled: boolean };
  github?: { enabled: boolean };
  calendar?: { enabled: boolean };
  claudeCode?: { enabled: boolean };
  evaluator?: { enabled: boolean };
  promptImprovement?: { enabled: boolean };
  aiProcessingLogExtract?: { enabled?: boolean; intervalMinutes?: number };
  summarizer?: {
    provider?: "claude" | "lmstudio";
    dailyScheduleHour?: number;
    timesIntervalMinutes?: number;
    lmstudio?: {
      url?: string;
      model?: string;
    };
  };
  taskElaboration?: {
    defaultLevel?: "light" | "standard" | "detailed";
  };
  rateLimit?: {
    enabled?: boolean;
    limits?: {
      requestsPerMinute?: number;
      requestsPerHour?: number;
      requestsPerDay?: number;
      tokensPerMinute?: number;
      tokensPerHour?: number;
      tokensPerDay?: number;
    };
  };
  aiProvider?: {
    lmstudio?: {
      url?: string;
      model?: string;
      timeout?: number;
    };
    providers?: Partial<AIProviderConfig["providers"]>;
    enableFallback?: boolean;
  };
  slackKeywords?: {
    watchKeywords?: string[];
  };
}

/** enabled 設定を持つ連携機能のキー */
const INTEGRATION_KEYS = [
  "whisper",
  "slack",
  "github",
  "calendar",
  "claudeCode",
  "evaluator",
  "promptImprovement",
  "aiProcessingLogExtract",
] as const;

/**
 * 連携機能の enabled 設定を更新
 */
function updateIntegrationEnabled(config: AdasConfig, body: IntegrationsUpdateBody): boolean {
  let updated = false;

  for (const key of INTEGRATION_KEYS) {
    if (body[key]?.enabled !== undefined) {
      (config[key] as { enabled: boolean }).enabled = body[key]?.enabled;
      updated = true;
    }
  }

  return updated;
}

/**
 * summarizer 設定を更新
 */
function updateSummarizerConfig(
  config: AdasConfig,
  summarizer: IntegrationsUpdateBody["summarizer"],
): boolean {
  if (!summarizer) return false;

  let updated = false;

  if (summarizer.provider !== undefined) {
    config.summarizer.provider = summarizer.provider;
    updated = true;
  }
  if (summarizer.dailyScheduleHour !== undefined) {
    // 0-23 の範囲でバリデーション
    const hour = Math.max(0, Math.min(23, summarizer.dailyScheduleHour));
    config.summarizer.dailyScheduleHour = hour;
    updated = true;
  }
  if (summarizer.timesIntervalMinutes !== undefined) {
    // 0 以上でバリデーション (0 = 無効)
    const interval = Math.max(0, summarizer.timesIntervalMinutes);
    config.summarizer.timesIntervalMinutes = interval;
    updated = true;
  }
  if (summarizer.lmstudio?.url !== undefined) {
    config.summarizer.lmstudio.url = summarizer.lmstudio.url;
    updated = true;
  }
  if (summarizer.lmstudio?.model !== undefined) {
    config.summarizer.lmstudio.model = summarizer.lmstudio.model;
    updated = true;
  }

  return updated;
}

/**
 * taskElaboration 設定を更新
 */
function updateTaskElaborationConfig(
  config: AdasConfig,
  taskElaboration: IntegrationsUpdateBody["taskElaboration"],
): boolean {
  if (!taskElaboration) return false;

  let updated = false;

  if (taskElaboration.defaultLevel !== undefined) {
    // taskElaboration セクションが存在しない場合は初期化
    if (!config.taskElaboration) {
      config.taskElaboration = { defaultLevel: "standard" };
    }
    config.taskElaboration.defaultLevel = taskElaboration.defaultLevel;
    updated = true;
  }

  return updated;
}

/**
 * rateLimit 設定を更新
 */
function updateRateLimitConfig(
  config: AdasConfig,
  rateLimit: IntegrationsUpdateBody["rateLimit"],
): boolean {
  if (!rateLimit) return false;

  let updated = false;

  if (rateLimit.enabled !== undefined) {
    config.rateLimit.enabled = rateLimit.enabled;
    updated = true;
  }

  if (rateLimit.limits) {
    const limits = rateLimit.limits;
    if (limits.requestsPerMinute !== undefined) {
      config.rateLimit.limits.requestsPerMinute = Math.max(1, limits.requestsPerMinute);
      updated = true;
    }
    if (limits.requestsPerHour !== undefined) {
      config.rateLimit.limits.requestsPerHour = Math.max(1, limits.requestsPerHour);
      updated = true;
    }
    if (limits.requestsPerDay !== undefined) {
      config.rateLimit.limits.requestsPerDay = Math.max(1, limits.requestsPerDay);
      updated = true;
    }
    if (limits.tokensPerMinute !== undefined) {
      config.rateLimit.limits.tokensPerMinute = Math.max(1, limits.tokensPerMinute);
      updated = true;
    }
    if (limits.tokensPerHour !== undefined) {
      config.rateLimit.limits.tokensPerHour = Math.max(1, limits.tokensPerHour);
      updated = true;
    }
    if (limits.tokensPerDay !== undefined) {
      config.rateLimit.limits.tokensPerDay = Math.max(1, limits.tokensPerDay);
      updated = true;
    }
  }

  return updated;
}

/**
 * aiProvider 設定を更新
 */
function updateAIProviderConfig(
  config: AdasConfig,
  aiProvider: IntegrationsUpdateBody["aiProvider"],
): boolean {
  if (!aiProvider) return false;

  let updated = false;

  // LM Studio 設定
  if (aiProvider.lmstudio) {
    if (aiProvider.lmstudio.url !== undefined) {
      config.aiProvider.lmstudio.url = aiProvider.lmstudio.url;
      updated = true;
    }
    if (aiProvider.lmstudio.model !== undefined) {
      config.aiProvider.lmstudio.model = aiProvider.lmstudio.model;
      updated = true;
    }
    if (aiProvider.lmstudio.timeout !== undefined) {
      config.aiProvider.lmstudio.timeout = Math.max(1000, aiProvider.lmstudio.timeout);
      updated = true;
    }
  }

  // 各処理ごとの provider 設定
  if (aiProvider.providers) {
    const validProviders: LLMProviderType[] = ["claude", "lmstudio"];
    for (const [key, value] of Object.entries(aiProvider.providers)) {
      if (value && validProviders.includes(value)) {
        (config.aiProvider.providers as Record<string, LLMProviderType>)[key] = value;
        updated = true;
      }
    }
  }

  // フォールバック設定
  if (aiProvider.enableFallback !== undefined) {
    config.aiProvider.enableFallback = aiProvider.enableFallback;
    updated = true;
  }

  return updated;
}

/**
 * AI Processing Log Extract 設定を更新
 */
function updateAiProcessingLogExtractConfig(
  config: AdasConfig,
  aiProcessingLogExtract: IntegrationsUpdateBody["aiProcessingLogExtract"],
): boolean {
  if (!aiProcessingLogExtract) return false;

  let updated = false;

  if (aiProcessingLogExtract.enabled !== undefined) {
    config.aiProcessingLogExtract.enabled = aiProcessingLogExtract.enabled;
    updated = true;
  }
  if (aiProcessingLogExtract.intervalMinutes !== undefined) {
    // 0 以上でバリデーション (0 = 無効)
    const interval = Math.max(0, aiProcessingLogExtract.intervalMinutes);
    config.aiProcessingLogExtract.intervalMinutes = interval;
    updated = true;
  }

  return updated;
}

/**
 * Slack キーワード設定を更新
 */
function updateSlackKeywordsConfig(
  config: AdasConfig,
  slackKeywords: IntegrationsUpdateBody["slackKeywords"],
): boolean {
  if (!slackKeywords) return false;

  let updated = false;

  if (slackKeywords.watchKeywords !== undefined) {
    config.slack.watchKeywords = slackKeywords.watchKeywords;
    updated = true;
  }

  return updated;
}

/**
 * 連携機能の有効/無効設定を管理するAPI
 * トークンなどの機密情報は返さない
 */
export function createConfigRouter() {
  const app = new Hono();

  // 設定取得 (機密情報をマスク)
  app.get("/", (c) => {
    const config = loadConfig();

    // 連携機能のステータスのみ返す (トークン等は除外)
    const integrations = {
      whisper: {
        enabled: config.whisper.enabled,
        engine: config.whisper.engine,
        language: config.whisper.language,
      },
      slack: {
        enabled: config.slack.enabled,
        hasCredentials: !!(config.slack.xoxcToken && config.slack.xoxdToken),
        userId: config.slack.userId,
        fetchIntervalMinutes: config.slack.fetchIntervalMinutes,
        channels: config.slack.channels,
        watchKeywords: config.slack.watchKeywords,
      },
      github: {
        enabled: config.github.enabled,
        username: config.github.username,
        fetchIntervalMinutes: config.github.fetchIntervalMinutes,
      },
      calendar: {
        enabled: config.calendar.enabled,
        fetchIntervalMinutes: config.calendar.fetchIntervalMinutes,
        calendarIds: config.calendar.calendarIds,
        hasCredentials: existsSync(config.calendar.credentialsPath),
      },
      claudeCode: {
        enabled: config.claudeCode.enabled,
        fetchIntervalMinutes: config.claudeCode.fetchIntervalMinutes,
        projects: config.claudeCode.projects,
      },
      evaluator: {
        enabled: config.evaluator.enabled,
        autoApplyPatterns: config.evaluator.autoApplyPatterns,
      },
      promptImprovement: {
        enabled: config.promptImprovement.enabled,
        badFeedbackThreshold: config.promptImprovement.badFeedbackThreshold,
      },
      aiProcessingLogExtract: {
        enabled: config.aiProcessingLogExtract.enabled,
        intervalMinutes: config.aiProcessingLogExtract.intervalMinutes,
      },
      summarizer: {
        provider: config.summarizer.provider,
        dailyScheduleHour: config.summarizer.dailyScheduleHour ?? 23,
        timesIntervalMinutes: config.summarizer.timesIntervalMinutes ?? 0,
        lmstudio: {
          url: config.summarizer.lmstudio.url,
          model: config.summarizer.lmstudio.model,
          timeout: config.summarizer.lmstudio.timeout,
        },
      },
      taskElaboration: {
        defaultLevel: config.taskElaboration?.defaultLevel ?? "standard",
      },
      rateLimit: {
        enabled: config.rateLimit.enabled,
        limits: config.rateLimit.limits,
        priorityMultipliers: config.rateLimit.priorityMultipliers,
      },
      aiProvider: {
        lmstudio: {
          url: config.aiProvider.lmstudio.url,
          model: config.aiProvider.lmstudio.model,
          timeout: config.aiProvider.lmstudio.timeout,
        },
        providers: config.aiProvider.providers,
        enableFallback: config.aiProvider.enableFallback,
      },
      launcher: {
        url: config.launcher?.url ?? "http://localhost:3999",
        token: config.launcher?.token ?? "",
      },
      worker: {
        url: config.worker.url,
        remote: config.worker.remote ?? false,
        token: config.worker.token ?? "",
      },
      localWorker: {
        url: config.localWorker.url,
        remote: config.localWorker.remote ?? false,
        token: config.localWorker.token ?? "",
      },
      workerLauncher: {
        url: config.workerLauncher?.url ?? "http://localhost:3998",
        token: config.workerLauncher?.token ?? "",
      },
    };

    return c.json({ integrations });
  });

  // 連携機能のオンオフを更新
  app.patch("/integrations", async (c) => {
    const body = await c.req.json<IntegrationsUpdateBody>();
    const config = loadConfig();

    const enabledUpdated = updateIntegrationEnabled(config, body);
    const summarizerUpdated = updateSummarizerConfig(config, body.summarizer);
    const taskElaborationUpdated = updateTaskElaborationConfig(config, body.taskElaboration);
    const rateLimitUpdated = updateRateLimitConfig(config, body.rateLimit);
    const aiProviderUpdated = updateAIProviderConfig(config, body.aiProvider);
    const slackKeywordsUpdated = updateSlackKeywordsConfig(config, body.slackKeywords);
    const aiLogExtractUpdated = updateAiProcessingLogExtractConfig(
      config,
      body.aiProcessingLogExtract,
    );
    const updated =
      enabledUpdated ||
      summarizerUpdated ||
      taskElaborationUpdated ||
      rateLimitUpdated ||
      aiProviderUpdated ||
      slackKeywordsUpdated ||
      aiLogExtractUpdated;

    if (updated) {
      saveConfig(config);
    }

    // 更新後の状態を返す
    return c.json({
      message: updated ? "設定を更新しました" : "変更はありません",
      requiresRestart: updated,
      integrations: {
        whisper: { enabled: config.whisper.enabled },
        slack: { enabled: config.slack.enabled, watchKeywords: config.slack.watchKeywords },
        github: { enabled: config.github.enabled },
        calendar: { enabled: config.calendar.enabled },
        claudeCode: { enabled: config.claudeCode.enabled },
        evaluator: { enabled: config.evaluator.enabled },
        promptImprovement: { enabled: config.promptImprovement.enabled },
        aiProcessingLogExtract: {
          enabled: config.aiProcessingLogExtract.enabled,
          intervalMinutes: config.aiProcessingLogExtract.intervalMinutes,
        },
        summarizer: {
          provider: config.summarizer.provider,
          dailyScheduleHour: config.summarizer.dailyScheduleHour ?? 23,
          timesIntervalMinutes: config.summarizer.timesIntervalMinutes ?? 0,
          lmstudio: {
            url: config.summarizer.lmstudio.url,
            model: config.summarizer.lmstudio.model,
          },
        },
        taskElaboration: {
          defaultLevel: config.taskElaboration?.defaultLevel ?? "standard",
        },
        rateLimit: {
          enabled: config.rateLimit.enabled,
          limits: config.rateLimit.limits,
        },
        aiProvider: {
          lmstudio: {
            url: config.aiProvider.lmstudio.url,
            model: config.aiProvider.lmstudio.model,
            timeout: config.aiProvider.lmstudio.timeout,
          },
          providers: config.aiProvider.providers,
          enableFallback: config.aiProvider.enableFallback,
        },
      },
    });
  });

  // LM Studio モデル一覧を取得
  app.get("/lmstudio/models", async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "URL is required" }, 400);
    }

    try {
      const response = await fetch(`${url}/v1/models`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return c.json({ error: `LM Studio returned ${response.status}` }, 502);
      }

      const result = (await response.json()) as { data: Array<{ id: string }> };
      const models = result.data?.map((m) => m.id) ?? [];

      return c.json({ models });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      return c.json({ error: message }, 502);
    }
  });

  // LM Studio 接続テスト
  app.post("/lmstudio/test", async (c) => {
    const body = await c.req.json<{ url: string }>();

    try {
      const response = await fetch(`${body.url}/v1/models`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return c.json({ success: false, error: `Status ${response.status}` });
      }

      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      return c.json({ success: false, error: message });
    }
  });

  // プロジェクト設定取得
  app.get("/projects", (c) => {
    const config = loadConfig();

    return c.json({
      gitScanPaths: config.projects?.gitScanPaths ?? [],
      excludePatterns: config.projects?.excludePatterns ?? [],
    });
  });

  // プロジェクト設定更新
  app.patch("/projects", async (c) => {
    const body = await c.req.json<{
      gitScanPaths?: string[];
      excludePatterns?: string[];
    }>();

    const config = loadConfig();

    // projects セクションが存在しない場合は初期化
    if (!config.projects) {
      config.projects = {
        gitScanPaths: [],
        excludePatterns: [],
      };
    }

    let updated = false;

    if (body.gitScanPaths !== undefined) {
      config.projects.gitScanPaths = body.gitScanPaths;
      updated = true;
    }
    if (body.excludePatterns !== undefined) {
      config.projects.excludePatterns = body.excludePatterns;
      updated = true;
    }

    if (updated) {
      saveConfig(config);
    }

    return c.json({
      message: updated ? "設定を更新しました" : "変更はありません",
      gitScanPaths: config.projects.gitScanPaths,
      excludePatterns: config.projects.excludePatterns,
    });
  });

  return app;
}
