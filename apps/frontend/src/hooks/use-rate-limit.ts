/**
 * Rate Limit Hook
 *
 * レート制限の状態を取得・更新
 */

import type { RateLimitStatus } from "@repo/types";
import { useCallback, useEffect, useState } from "react";

const API_BASE = "/api/rate-limit";
const POLL_INTERVAL_MS = 30 * 1000; // 30秒

export function useRateLimit() {
  const [status, setStatus] = useState<RateLimitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) {
        throw new Error(`Failed to fetch rate limit status: ${res.status}`);
      }
      const data = (await res.json()) as RateLimitStatus;
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回と定期ポーリング
  useEffect(() => {
    fetchStatus();

    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
  };
}
