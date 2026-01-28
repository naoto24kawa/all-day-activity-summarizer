import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, postAdasApi } from "./use-adas-api";

export interface UnknownSpeakerSummary {
  id: string;
  firstSeen: string;
  lastSeen: string;
  sampleTexts: string[];
  occurrenceCount: number;
}

export function useUnknownSpeakers() {
  const [speakers, setSpeakers] = useState<UnknownSpeakerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSpeakers = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<UnknownSpeakerSummary[]>("/api/speakers");
      setSpeakers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch unknown speakers");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpeakers();
    const interval = setInterval(() => fetchSpeakers(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchSpeakers]);

  const assignSpeaker = useCallback(
    async (unknownId: string, name: string) => {
      await postAdasApi("/api/speakers/assign", { unknownId, name });
      await fetchSpeakers(true);
    },
    [fetchSpeakers],
  );

  const deleteSpeaker = useCallback(
    async (id: string) => {
      await deleteAdasApi(`/api/speakers/${id}`);
      await fetchSpeakers(true);
    },
    [fetchSpeakers],
  );

  return { speakers, error, loading, refetch: fetchSpeakers, assignSpeaker, deleteSpeaker };
}
