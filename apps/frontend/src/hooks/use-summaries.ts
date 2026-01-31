import type { GenerateSummaryResponse, Summary } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export function useSummaries(date: string, type?: "pomodoro" | "hourly" | "daily") {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummaries = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams({ date });
        if (type) params.set("type", type);
        const data = await fetchAdasApi<Summary[]>(`/api/summaries?${params}`);
        setSummaries(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch summaries");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date, type],
  );

  useEffect(() => {
    fetchSummaries();
    const interval = setInterval(() => fetchSummaries(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchSummaries]);

  const generateSummary = useCallback(
    async (body: { date?: string; type?: "pomodoro" | "hourly" | "daily"; hour?: number }) => {
      const result = await postAdasApi<GenerateSummaryResponse>("/api/summaries/generate", body);
      await fetchSummaries();
      return result;
    },
    [fetchSummaries],
  );

  return { summaries, error, loading, refetch: fetchSummaries, generateSummary };
}
