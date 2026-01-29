import { useCallback, useRef, useState } from "react";

export interface DisplayMediaState {
  stream: MediaStream | null;
  error: Error | null;
  isCapturing: boolean;
  hasAudioTrack: boolean;
}

export interface UseDisplayMediaReturn extends DisplayMediaState {
  startCapture: () => Promise<MediaStream | null>;
  stopCapture: () => void;
}

/**
 * getDisplayMedia (画面共有) でシステム音声をキャプチャするフック。
 *
 * macOS Chrome では、画面共有時に「システム音声を共有」オプションが表示される。
 * ただし、画面全体では利用できず、Chrome タブのみの可能性がある。
 */
export function useDisplayMedia(): UseDisplayMediaReturn {
  const [state, setState] = useState<DisplayMediaState>({
    stream: null,
    error: null,
    isCapturing: false,
    hasAudioTrack: false,
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
      hasAudioTrack: false,
    });
  }, []);

  const startCapture = useCallback(async (): Promise<MediaStream | null> => {
    try {
      // getDisplayMedia で画面共有 + 音声をリクエスト
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // 画面共有には video が必要
        audio: {
          // システム音声をリクエスト
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const audioTracks = stream.getAudioTracks();
      const hasAudio = audioTracks.length > 0;

      // 動画トラックは不要なので停止(音声のみ使用)
      for (const videoTrack of stream.getVideoTracks()) {
        videoTrack.stop();
      }

      // 音声トラックがない場合は失敗
      if (!hasAudio) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return null;
      }

      streamRef.current = stream;
      setState({
        stream,
        error: null,
        isCapturing: true,
        hasAudioTrack: hasAudio,
      });

      // トラック終了時のハンドリング
      audioTracks[0]?.addEventListener("ended", () => {
        stopCapture();
      });

      return stream;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState((prev) => ({
        ...prev,
        error,
        isCapturing: false,
      }));
      return null;
    }
  }, [stopCapture]);

  return {
    ...state,
    startCapture,
    stopCapture,
  };
}
