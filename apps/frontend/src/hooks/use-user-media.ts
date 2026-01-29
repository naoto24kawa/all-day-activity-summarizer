import { useCallback, useRef, useState } from "react";

export interface UserMediaState {
  stream: MediaStream | null;
  error: Error | null;
  isCapturing: boolean;
}

export interface UseUserMediaReturn extends UserMediaState {
  startCapture: () => Promise<MediaStream | null>;
  stopCapture: () => void;
}

/**
 * getUserMedia でマイク音声をキャプチャするフック。
 */
export function useUserMedia(): UseUserMediaReturn {
  const [state, setState] = useState<UserMediaState>({
    stream: null,
    error: null,
    isCapturing: false,
  });
  const streamRef = useRef<MediaStream | null>(null);

  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setState({
      stream: null,
      error: null,
      isCapturing: false,
    });
  }, []);

  const startCapture = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      streamRef.current = stream;
      setState({
        stream,
        error: null,
        isCapturing: true,
      });

      // トラック終了時のハンドリング
      const audioTrack = stream.getAudioTracks()[0];
      audioTrack?.addEventListener("ended", () => {
        stopCapture();
      });

      return stream;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState({
        stream: null,
        error,
        isCapturing: false,
      });
      return null;
    }
  }, [stopCapture]);

  return {
    ...state,
    startCapture,
    stopCapture,
  };
}
