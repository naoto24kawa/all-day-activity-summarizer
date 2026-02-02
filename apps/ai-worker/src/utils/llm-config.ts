/**
 * Worker 用 LLM 設定ユーティリティ
 *
 * ~/.adas/config.json から AI プロバイダー設定を読み込み、
 * 各処理で使用する LLM Provider を切り替える。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createLLMProvider,
  createLLMProviderWithFallback,
  type LLMProvider,
  type LLMProviderConfig,
} from "@repo/core";

/** 処理の種類 */
export type ProcessType =
  | "summarize"
  | "suggestTags"
  | "evaluate"
  | "interpret"
  | "checkCompletion"
  | "analyzeProfile"
  | "extractLearnings"
  | "taskExtract";

/** AI プロバイダー設定の型 */
interface AIProviderConfig {
  lmstudio: {
    url: string;
    model: string;
    timeout: number;
  };
  providers: Record<ProcessType, "claude" | "lmstudio">;
  enableFallback: boolean;
}

/** 設定ファイルの型 (必要な部分のみ) */
interface AdasConfigPartial {
  aiProvider?: AIProviderConfig;
}

/** デフォルト設定 */
const defaultAIProviderConfig: AIProviderConfig = {
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
  },
  enableFallback: true,
};

let cachedConfig: AIProviderConfig | null = null;

/**
 * ~/.adas/config.json から AI プロバイダー設定を読み込む
 */
export function loadAIProviderConfig(): AIProviderConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = join(homedir(), ".adas", "config.json");

  if (!existsSync(configPath)) {
    cachedConfig = defaultAIProviderConfig;
    return cachedConfig;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as AdasConfigPartial;

    cachedConfig = {
      ...defaultAIProviderConfig,
      ...parsed.aiProvider,
      lmstudio: {
        ...defaultAIProviderConfig.lmstudio,
        ...parsed.aiProvider?.lmstudio,
      },
      providers: {
        ...defaultAIProviderConfig.providers,
        ...parsed.aiProvider?.providers,
      },
    };

    return cachedConfig;
  } catch {
    cachedConfig = defaultAIProviderConfig;
    return cachedConfig;
  }
}

/**
 * 設定キャッシュをクリア (テスト用)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * 指定された処理タイプ用の LLM Provider を取得
 *
 * @param processType 処理の種類
 * @param claudeModel Claude 使用時のモデル (haiku, sonnet, opus-4)
 * @returns LLM Provider インスタンス
 */
export function getLLMProviderForProcess(
  processType: ProcessType,
  claudeModel?: string,
): LLMProvider {
  const config = loadAIProviderConfig();
  const providerType = config.providers[processType];

  const llmConfig: LLMProviderConfig = {
    provider: providerType,
    lmstudio: config.lmstudio,
    claudeModel,
  };

  if (config.enableFallback && providerType === "lmstudio") {
    return createLLMProviderWithFallback(llmConfig);
  }

  return createLLMProvider(llmConfig);
}

/**
 * 現在の設定情報を取得 (デバッグ/ログ用)
 */
export function getProviderInfo(processType: ProcessType): { provider: string; url?: string } {
  const config = loadAIProviderConfig();
  const providerType = config.providers[processType];

  if (providerType === "lmstudio") {
    return {
      provider: config.enableFallback ? "lmstudio->claude" : "lmstudio",
      url: config.lmstudio.url,
    };
  }

  return { provider: "claude" };
}
