import type { StatusResponse } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "./use-adas-api";

export function useStatus(pollInterval = 10_000) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await fetchAdasApi<StatusResponse>("/api/status");
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  return { status, error, loading, refetch: fetchStatus };
}
