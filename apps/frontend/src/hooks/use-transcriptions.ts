import type { TranscriptionSegment } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "./use-adas-api";

export function useTranscriptions(date: string) {
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTranscriptions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAdasApi<TranscriptionSegment[]>(`/api/transcriptions?date=${date}`);
      setSegments(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch transcriptions");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchTranscriptions();
  }, [fetchTranscriptions]);

  return { segments, error, loading, refetch: fetchTranscriptions };
}
