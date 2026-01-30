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
  };
  github: IntegrationStatus & {
    username?: string;
    fetchIntervalMinutes: number;
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
}

interface ConfigResponse {
  integrations: IntegrationsConfig;
}

interface UpdateIntegrationsResponse {
  message: string;
  requiresRestart: boolean;
  integrations: {
    whisper: IntegrationStatus;
    slack: IntegrationStatus;
    github: IntegrationStatus;
    claudeCode: IntegrationStatus;
    evaluator: IntegrationStatus;
    promptImprovement: IntegrationStatus;
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
        | "claudeCode"
        | "evaluator"
        | "promptImprovement",
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
          return {
            ...prev,
            [integration]: {
              ...prev[integration],
              enabled: data.integrations[integration].enabled,
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
  };
}
