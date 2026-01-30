import type { AiProcessingLog, AiProcessType } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";

interface AiProcessingLogsStats {
  total: number;
  success: number;
  error: number;
  avgDuration: number;
  byProcessType: Record<string, { success: number; error: number; avgDuration: number }>;
}

interface UseAiProcessingLogsOptions {
  date?: string;
  processType?: AiProcessType;
  status?: "success" | "error";
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useAiProcessingLogs(options: UseAiProcessingLogsOptions = {}) {
  const {
    date,
    processType,
    status,
    limit = 200,
    autoRefresh = true,
    refreshInterval = 30000,
  } = options;

  const [logs, setLogs] = useState<AiProcessingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (processType) params.set("processType", processType);
      if (status) params.set("status", status);
      params.set("limit", limit.toString());

      const data = await fetchAdasApi<AiProcessingLog[]>(
        `/api/ai-processing-logs?${params.toString()}`,
      );
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [date, processType, status, limit]);

  useEffect(() => {
    fetchLogs();

    if (autoRefresh) {
      const interval = setInterval(fetchLogs, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchLogs, autoRefresh, refreshInterval]);

  return { logs, loading, error, refetch: fetchLogs };
}

export function useAiProcessingLogsStats(date?: string) {
  const [stats, setStats] = useState<AiProcessingLogsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const data = await fetchAdasApi<AiProcessingLogsStats>(
        `/api/ai-processing-logs/stats?${params.toString()}`,
      );
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}
