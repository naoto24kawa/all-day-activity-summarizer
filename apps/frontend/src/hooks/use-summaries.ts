import type { GenerateSummaryResponse, Summary } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "./use-adas-api";

export function useSummaries(date: string, type?: "hourly" | "daily") {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummaries = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ date });
      if (type) params.set("type", type);
      const data = await fetchAdasApi<Summary[]>(`/api/summaries?${params}`);
      setSummaries(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch summaries");
    } finally {
      setLoading(false);
    }
  }, [date, type]);

  useEffect(() => {
    fetchSummaries();
  }, [fetchSummaries]);

  const generateSummary = useCallback(
    async (body: { date?: string; type?: "hourly" | "daily"; hour?: number }) => {
      const result = await postAdasApi<GenerateSummaryResponse>("/api/summaries/generate", body);
      await fetchSummaries();
      return result;
    },
    [fetchSummaries],
  );

  return { summaries, error, loading, refetch: fetchSummaries, generateSummary };
}
