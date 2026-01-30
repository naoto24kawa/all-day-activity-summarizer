import { Hono } from "hono";
import { loadConfig, saveConfig } from "../../config.js";

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
    };

    return c.json({ integrations });
  });

  // 連携機能のオンオフを更新
  app.patch("/integrations", async (c) => {
    const body = await c.req.json<{
      whisper?: { enabled: boolean };
      slack?: { enabled: boolean };
      github?: { enabled: boolean };
      claudeCode?: { enabled: boolean };
      evaluator?: { enabled: boolean };
      promptImprovement?: { enabled: boolean };
    }>();

    const config = loadConfig();
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
      },
    });
  });

  return app;
}
