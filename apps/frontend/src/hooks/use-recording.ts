import type { RecordingSourceResponse, RecordingStatusResponse } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "./use-adas-api";

export function useRecording(pollInterval = 5_000) {
  const [micRecording, setMicRecording] = useState<boolean | null>(null);
  const [speakerRecording, setSpeakerRecording] = useState<boolean | null>(null);
  const [togglingMic, setTogglingMic] = useState(false);
  const [togglingSpeaker, setTogglingSpeaker] = useState(false);

  const fetchRecording = useCallback(async () => {
    try {
      const data = await fetchAdasApi<RecordingStatusResponse>("/api/recording");
      setMicRecording(data.mic);
      setSpeakerRecording(data.speaker);
    } catch {
      // recording endpoint not available (e.g. serve-only mode)
      setMicRecording(null);
      setSpeakerRecording(null);
    }
  }, []);

  useEffect(() => {
    fetchRecording();
    const interval = setInterval(fetchRecording, pollInterval);
    return () => clearInterval(interval);
  }, [fetchRecording, pollInterval]);

  const toggleMic = useCallback(
    async (checked: boolean) => {
      setTogglingMic(true);
      try {
        const data = await postAdasApi<RecordingSourceResponse>("/api/recording/mic", {
          recording: checked,
        });
        setMicRecording(data.recording);
      } catch {
        await fetchRecording();
      } finally {
        setTogglingMic(false);
      }
    },
    [fetchRecording],
  );

  const toggleSpeaker = useCallback(
    async (checked: boolean) => {
      setTogglingSpeaker(true);
      try {
        const data = await postAdasApi<RecordingSourceResponse>("/api/recording/speaker", {
          recording: checked,
        });
        setSpeakerRecording(data.recording);
      } catch {
        await fetchRecording();
      } finally {
        setTogglingSpeaker(false);
      }
    },
    [fetchRecording],
  );

  return {
    micRecording,
    speakerRecording,
    togglingMic,
    togglingSpeaker,
    toggleMic,
    toggleSpeaker,
  };
}
