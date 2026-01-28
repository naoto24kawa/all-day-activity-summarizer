import type { EvaluatorLog } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "./use-adas-api";

export function useEvaluatorLogs(date: string) {
  const [logs, setLogs] = useState<EvaluatorLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const data = await fetchAdasApi<EvaluatorLog[]>(`/api/evaluator-logs?date=${date}`);
        setLogs(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch evaluator logs");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(() => fetchLogs(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return { logs, error, loading, refetch: fetchLogs };
}
