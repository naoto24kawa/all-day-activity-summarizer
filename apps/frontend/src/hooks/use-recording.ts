import type { RecordingStatusResponse } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "./use-adas-api";

export function useRecording(pollInterval = 5_000) {
  const [recording, setRecording] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchRecording = useCallback(async () => {
    try {
      const data = await fetchAdasApi<RecordingStatusResponse>("/api/recording");
      setRecording(data.recording);
    } catch {
      // recording endpoint not available (e.g. serve-only mode)
      setRecording(null);
    }
  }, []);

  useEffect(() => {
    fetchRecording();
    const interval = setInterval(fetchRecording, pollInterval);
    return () => clearInterval(interval);
  }, [fetchRecording, pollInterval]);

  const toggle = useCallback(
    async (checked: boolean) => {
      setToggling(true);
      try {
        const data = await postAdasApi<RecordingStatusResponse>("/api/recording", {
          recording: checked,
        });
        setRecording(data.recording);
      } catch {
        // revert on error by re-fetching
        await fetchRecording();
      } finally {
        setToggling(false);
      }
    },
    [fetchRecording],
  );

  return { recording, toggling, toggle };
}
