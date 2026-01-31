import { Hono } from "hono";
import type { AdasConfig } from "../../config.js";
import { loadConfig, saveConfig } from "../../config.js";

interface IntegrationsUpdateBody {
  whisper?: { enabled: boolean };
  slack?: { enabled: boolean };
  github?: { enabled: boolean };
  claudeCode?: { enabled: boolean };
  evaluator?: { enabled: boolean };
  promptImprovement?: { enabled: boolean };
  summarizer?: {
    provider?: "claude" | "lmstudio";
    lmstudio?: {
      url?: string;
      model?: string;
    };
  };
}

/**
 * 連携機能の enabled 設定を更新
 */
function updateIntegrationEnabled(config: AdasConfig, body: IntegrationsUpdateBody): boolean {
  let updated = false;

  if (body.whisper !== undefined) {
    config.whisper.enabled = body.whisper.enabled;
    updated = true;
  }
  if (body.slack !== undefined) {
    config.slack.enabled = body.slack.enabled;
    updated = true;
  }
  if (body.github !== undefined) {
    config.github.enabled = body.github.enabled;
    updated = true;
  }
  if (body.claudeCode !== undefined) {
    config.claudeCode.enabled = body.claudeCode.enabled;
    updated = true;
  }
  if (body.evaluator !== undefined) {
    config.evaluator.enabled = body.evaluator.enabled;
    updated = true;
  }
  if (body.promptImprovement !== undefined) {
    config.promptImprovement.enabled = body.promptImprovement.enabled;
    updated = true;
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
      summarizer: {
        provider: config.summarizer.provider,
        lmstudio: {
          url: config.summarizer.lmstudio.url,
          model: config.summarizer.lmstudio.model,
          timeout: config.summarizer.lmstudio.timeout,
        },
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
    const updated = enabledUpdated || summarizerUpdated;

    if (updated) {
      saveConfig(config);
    }

    // 更新後の状態を返す
    return c.json({
      message: updated ? "設定を更新しました" : "変更はありません",
      requiresRestart: updated,
      integrations: {
        whisper: { enabled: config.whisper.enabled },
        slack: { enabled: config.slack.enabled },
        github: { enabled: config.github.enabled },
        claudeCode: { enabled: config.claudeCode.enabled },
        evaluator: { enabled: config.evaluator.enabled },
        promptImprovement: { enabled: config.promptImprovement.enabled },
        summarizer: {
          provider: config.summarizer.provider,
          lmstudio: {
            url: config.summarizer.lmstudio.url,
            model: config.summarizer.lmstudio.model,
          },
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

  return app;
}
