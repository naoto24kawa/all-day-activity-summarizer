/**
 * 共通エラーレスポンス関数
 *
 * 機能無効時のエラーハンドリングを統一する
 */

import type { Context } from "hono";

/**
 * 機能の日本語名マッピング
 */
const FEATURE_NAMES: Record<string, string> = {
  whisper: "文字起こし (Whisper)",
  slack: "Slack 連携",
  github: "GitHub 連携",
  claudeCode: "Claude Code 連携",
  evaluator: "AI 評価",
  promptImprovement: "プロンプト改善",
};

/**
 * 機能が無効化されている場合のエラーレスポンス
 *
 * HTTP 503 Service Unavailable を返す
 * (機能は存在するが、設定により利用不可)
 *
 * @param c - Hono Context
 * @param feature - 機能名 (whisper, slack, github, claudeCode, evaluator, promptImprovement)
 * @returns JSON レスポンス (503)
 */
export function featureDisabledResponse(c: Context, feature: keyof typeof FEATURE_NAMES) {
  const featureName = FEATURE_NAMES[feature] || feature;

  return c.json(
    {
      error: "FEATURE_DISABLED",
      message: `${featureName}は無効化されています`,
      details: {
        feature,
        featureName,
        hint: "Settings タブの Integrations から有効化できます",
      },
    },
    503,
  );
}

/**
 * 機能が無効かどうかをチェックするヘルパー
 */
export function isFeatureDisabled(config: { enabled: boolean } | undefined): boolean {
  return !config?.enabled;
}
