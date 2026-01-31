import type { TranscriptionSegment } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";

export function useTranscriptions(date: string) {
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTranscriptions = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const data = await fetchAdasApi<TranscriptionSegment[]>(`/api/transcriptions?date=${date}`);
        setSegments(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch transcriptions");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchTranscriptions();
    const interval = setInterval(() => fetchTranscriptions(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchTranscriptions]);

  return { segments, error, loading, refetch: fetchTranscriptions };
}
