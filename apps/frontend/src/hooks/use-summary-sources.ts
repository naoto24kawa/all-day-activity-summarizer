import type { SummarySourcesResponse } from "@repo/types";
import { useCallback, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";

interface UseSummarySourcesReturn {
  sources: SummarySourcesResponse | null;
  loading: boolean;
  error: string | null;
  fetchSources: (summaryId: number) => Promise<void>;
  clearSources: () => void;
}

export function useSummarySources(): UseSummarySourcesReturn {
  const [sources, setSources] = useState<SummarySourcesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSources = useCallback(async (summaryId: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAdasApi<SummarySourcesResponse>(
        `/api/summaries/${summaryId}/sources`,
      );
      setSources(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sources");
      setSources(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSources = useCallback(() => {
    setSources(null);
    setError(null);
  }, []);

  return {
    sources,
    loading,
    error,
    fetchSources,
    clearSources,
  };
}
