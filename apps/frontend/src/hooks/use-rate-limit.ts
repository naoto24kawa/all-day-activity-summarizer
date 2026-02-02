/**
 * Rate Limit Hook
 *
 * レート制限の状態を取得・更新
 * SSE でリアルタイム更新 + 初回フェッチ
 */

import type { RateLimitStatus } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";
import { useSSE } from "./use-sse";

export function useRateLimit() {
  const [status, setStatus] = useState<RateLimitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // SSE でレート制限更新を受信
  const handleRateLimitUpdated = useCallback((data: RateLimitStatus) => {
    setStatus(data);
    setError(null);
  }, []);

  useSSE({
    onRateLimitUpdated: handleRateLimitUpdated,
  });

  const fetchStatus = useCallback(async () => {
    try {
      const data = await fetchAdasApi<RateLimitStatus>("/api/rate-limit/status");
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回フェッチのみ (ポーリングは廃止、SSE に移行)
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
  };
}
