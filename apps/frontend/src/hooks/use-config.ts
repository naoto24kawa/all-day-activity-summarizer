/**
 * Config hooks
 *
 * 連携機能の設定を管理するフック
 */

import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, patchAdasApi } from "@/lib/adas-api";

export interface IntegrationStatus {
  enabled: boolean;
}

export interface SummarizerConfig {
  provider: "claude" | "lmstudio";
  dailyScheduleHour: number;
  timesIntervalMinutes: number;
  dailySyncWithTimes: boolean;
  lmstudio: {
    url: string;
    model: string;
    timeout?: number;
  };
}

export type ElaborationLevel = "light" | "standard" | "detailed";

export interface TaskElaborationConfig {
  defaultLevel: ElaborationLevel;
}

export interface RateLimitLimits {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
}

export interface RateLimitPriorityMultipliers {
  high: number;
  medium: number;
  low: number;
  lowest: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  limits: RateLimitLimits;
  priorityMultipliers: RateLimitPriorityMultipliers;
}

/** LLM プロバイダーの種類 */
export type LLMProviderType = "claude" | "lmstudio";

/** 各処理で使用する provider の設定 */
export interface AIProviderProviders {
  summarize: LLMProviderType;
  suggestTags: LLMProviderType;
  evaluate: LLMProviderType;
  interpret: LLMProviderType;
  checkCompletion: LLMProviderType;
  analyzeProfile: LLMProviderType;
  extractLearnings: LLMProviderType;
  taskExtract: LLMProviderType;
  slackPriority: LLMProviderType;
}

/** AI プロバイダー設定 */
export interface AIProviderConfig {
  lmstudio: {
    url: string;
    model: string;
    timeout: number;
  };
  providers: AIProviderProviders;
  enableFallback: boolean;
}

export interface IntegrationsConfig {
  whisper: IntegrationStatus & {
    engine: "whisperx" | "whisper-cpp";
    language: string;
  };
  slack: IntegrationStatus & {
    hasCredentials: boolean;
    userId?: string;
    fetchIntervalMinutes: number;
    channels: string[];
    watchKeywords: string[];
    keywordPriority: "high" | "medium" | "low";
  };
  github: IntegrationStatus & {
    username?: string;
    fetchIntervalMinutes: number;
  };
  calendar?: IntegrationStatus & {
    fetchIntervalMinutes: number;
    calendarIds: string[];
    hasCredentials: boolean;
  };
  notion?: IntegrationStatus & {
    fetchIntervalMinutes: number;
    databaseIds: string[];
    hasToken: boolean;
  };
  claudeCode: IntegrationStatus & {
    fetchIntervalMinutes: number;
    projects: string[];
  };
  evaluator: IntegrationStatus & {
    autoApplyPatterns: boolean;
  };
  promptImprovement: IntegrationStatus & {
    badFeedbackThreshold: number;
  };
  aiProcessingLogExtract: IntegrationStatus & {
    intervalMinutes: number;
  };
  summarizer: SummarizerConfig;
  taskElaboration: TaskElaborationConfig;
  rateLimit: RateLimitConfig;
  aiProvider: AIProviderConfig;
  launcher: {
    url: string;
    token: string;
  };
  worker: {
    url: string;
    remote: boolean;
    token: string;
  };
  localWorker: {
    url: string;
    remote: boolean;
    token: string;
  };
  workerLauncher: {
    url: string;
    token: string;
  };
}

interface ConfigResponse {
  integrations: IntegrationsConfig;
}

interface UpdateIntegrationsResponse {
  message: string;
  requiresRestart: boolean;
  integrations: {
    whisper: IntegrationStatus;
    slack: IntegrationStatus & {
      watchKeywords?: string[];
      keywordPriority?: "high" | "medium" | "low";
    };
    github: IntegrationStatus;
    calendar?: IntegrationStatus;
    claudeCode: IntegrationStatus;
    evaluator: IntegrationStatus;
    promptImprovement: IntegrationStatus;
    aiProcessingLogExtract: IntegrationStatus & { intervalMinutes: number };
    summarizer: SummarizerConfig;
    taskElaboration: TaskElaborationConfig;
    rateLimit: { enabled: boolean; limits: RateLimitLimits };
    aiProvider: AIProviderConfig;
  };
}

/**
 * 連携機能の設定を管理するフック
 */
export function useConfig() {
  const [integrations, setIntegrations] = useState<IntegrationsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdasApi<ConfigResponse>("/api/config");
      setIntegrations(data.integrations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateIntegration = useCallback(
    async (
      integration:
        | "whisper"
        | "slack"
        | "github"
        | "calendar"
        | "notion"
        | "claudeCode"
        | "evaluator"
        | "promptImprovement"
        | "aiProcessingLogExtract",
      enabled: boolean,
    ) => {
      try {
        setUpdating(true);
        setError(null);
        const body = { [integration]: { enabled } };
        const data = await patchAdasApi<UpdateIntegrationsResponse>(
          "/api/config/integrations",
          body,
        );

        // ローカル状態を更新
        setIntegrations((prev) => {
          if (!prev) return prev;
          const responseIntegration = data.integrations[
            integration as keyof typeof data.integrations
          ] as IntegrationStatus | undefined;
          if (!responseIntegration) return prev;
          return {
            ...prev,
            [integration]: {
              ...prev[integration as keyof typeof prev],
              enabled: responseIntegration.enabled,
            },
          };
        });

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "設定の更新に失敗しました";
        setError(message);
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [],
  );

  const updateSummarizerConfig = useCallback(
    async (config: {
      provider?: "claude" | "lmstudio";
      dailyScheduleHour?: number;
      timesIntervalMinutes?: number;
      dailySyncWithTimes?: boolean;
      lmstudio?: { url?: string; model?: string };
    }) => {
      try {
        setUpdating(true);
        setError(null);
        const body = { summarizer: config };
        const data = await patchAdasApi<UpdateIntegrationsResponse>(
          "/api/config/integrations",
          body,
        );

        // ローカル状態を更新
        setIntegrations((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            summarizer: data.integrations.summarizer,
          };
        });

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "設定の更新に失敗しました";
        setError(message);
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [],
  );

  const updateRateLimitConfig = useCallback(
    async (config: { enabled?: boolean; limits?: Partial<RateLimitLimits> }) => {
      try {
        setUpdating(true);
        setError(null);
        const body = { rateLimit: config };
        const data = await patchAdasApi<UpdateIntegrationsResponse>(
          "/api/config/integrations",
          body,
        );

        // ローカル状態を更新
        setIntegrations((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rateLimit: {
              ...prev.rateLimit,
              enabled: data.integrations.rateLimit?.enabled ?? prev.rateLimit.enabled,
              limits: data.integrations.rateLimit?.limits ?? prev.rateLimit.limits,
            },
          };
        });

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "設定の更新に失敗しました";
        setError(message);
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [],
  );

  const updateAIProviderConfig = useCallback(
    async (config: {
      lmstudio?: { url?: string; model?: string; timeout?: number };
      providers?: Partial<AIProviderProviders>;
      enableFallback?: boolean;
    }) => {
      try {
        setUpdating(true);
        setError(null);
        const body = { aiProvider: config };
        const data = await patchAdasApi<UpdateIntegrationsResponse>(
          "/api/config/integrations",
          body,
        );

        // ローカル状態を更新
        setIntegrations((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            aiProvider: data.integrations.aiProvider,
          };
        });

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "設定の更新に失敗しました";
        setError(message);
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [],
  );

  const updateSlackKeywords = useCallback(
    async (config: { watchKeywords?: string[]; keywordPriority?: "high" | "medium" | "low" }) => {
      try {
        setUpdating(true);
        setError(null);
        const body = { slackKeywords: config };
        const data = await patchAdasApi<UpdateIntegrationsResponse>(
          "/api/config/integrations",
          body,
        );

        // ローカル状態を更新
        setIntegrations((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            slack: {
              ...prev.slack,
              ...(data.integrations.slack.watchKeywords !== undefined && {
                watchKeywords: data.integrations.slack.watchKeywords,
              }),
              ...(data.integrations.slack.keywordPriority !== undefined && {
                keywordPriority: data.integrations.slack.keywordPriority,
              }),
            },
          };
        });

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "設定の更新に失敗しました";
        setError(message);
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [],
  );

  const updateAiProcessingLogExtractConfig = useCallback(
    async (config: { enabled?: boolean; intervalMinutes?: number }) => {
      try {
        setUpdating(true);
        setError(null);
        const body = { aiProcessingLogExtract: config };
        const data = await patchAdasApi<UpdateIntegrationsResponse>(
          "/api/config/integrations",
          body,
        );

        // ローカル状態を更新
        setIntegrations((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            aiProcessingLogExtract: data.integrations.aiProcessingLogExtract,
          };
        });

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "設定の更新に失敗しました";
        setError(message);
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return {
    integrations,
    loading,
    error,
    updating,
    fetchConfig,
    updateIntegration,
    updateSummarizerConfig,
    updateRateLimitConfig,
    updateAIProviderConfig,
    updateSlackKeywords,
    updateAiProcessingLogExtractConfig,
  };
}
