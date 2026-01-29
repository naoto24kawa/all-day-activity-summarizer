import type { StorageMetrics } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";

/** ポーリング間隔(ms) */
const POLLING_INTERVAL = 30000;

/**
 * ストレージ情報を取得するフック
 * 30秒間隔でポーリング
 */
export function useStorage() {
  const [data, setData] = useState<StorageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStorage = useCallback(async () => {
    try {
      const metrics = await fetchAdasApi<StorageMetrics>("/api/storage");
      setData(metrics);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStorage();

    const interval = setInterval(fetchStorage, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStorage]);

  return { data, loading, error, refetch: fetchStorage };
}
