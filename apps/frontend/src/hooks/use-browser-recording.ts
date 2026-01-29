import type { BrowserRecordingChunkMetadata } from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioChunkManager } from "../lib/audio-chunk-manager";
import { useDisplayMedia } from "./use-display-media";
import { useUserMedia } from "./use-user-media";

export interface BrowserRecordingState {
  /** マイク録音中 */
  micRecording: boolean;
  /** システム音声録音中 */
  systemRecording: boolean;
  /** マイク音声レベル (0-1) */
  micLevel: number;
  /** システム音声レベル (0-1) */
  systemLevel: number;
  /** 最後のチャンク送信時刻 */
  lastChunkTime: Date | null;
  /** 録音開始時刻 */
  startedAt: Date | null;
  /** エラー */
  error: Error | null;
}

export interface UseBrowserRecordingReturn extends BrowserRecordingState {
  /** マイク録音を開始 */
  startMic: () => Promise<boolean>;
  /** マイク録音を停止 */
  stopMic: () => Promise<void>;
  /** システム音声録音を開始 */
  startSystem: () => Promise<boolean>;
  /** システム音声録音を停止 */
  stopSystem: () => Promise<void>;
  /** 両方を停止 */
  stopAll: () => Promise<void>;
}

/**
 * ブラウザでの音声録音を統合管理するフック。
 * マイク(getUserMedia)とシステム音声(getDisplayMedia)の両方をサポート。
 */
export function useBrowserRecording(): UseBrowserRecordingReturn {
  const [state, setState] = useState<BrowserRecordingState>({
    micRecording: false,
    systemRecording: false,
    micLevel: 0,
    systemLevel: 0,
    lastChunkTime: null,
    startedAt: null,
    error: null,
  });

  const micMedia = useUserMedia();
  const systemMedia = useDisplayMedia();

  const micChunkManagerRef = useRef<AudioChunkManager | null>(null);
  const systemChunkManagerRef = useRef<AudioChunkManager | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const systemAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const systemAudioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // レベル更新アニメーション
  const updateLevels = useCallback(() => {
    let micLevel = 0;
    let systemLevel = 0;

    if (micAnalyserRef.current) {
      const dataArray = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
      micAnalyserRef.current.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((a, b) => a + b, 0);
      micLevel = sum / dataArray.length / 255;
    }

    if (systemAnalyserRef.current) {
      const dataArray = new Uint8Array(systemAnalyserRef.current.frequencyBinCount);
      systemAnalyserRef.current.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((a, b) => a + b, 0);
      systemLevel = sum / dataArray.length / 255;
    }

    setState((prev) => ({
      ...prev,
      micLevel,
      systemLevel,
    }));

    if (micAnalyserRef.current || systemAnalyserRef.current) {
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    }
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const setupAnalyser = useCallback(
    (stream: MediaStream): { analyser: AnalyserNode; audioContext: AudioContext } => {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      return { analyser, audioContext };
    },
    [],
  );

  const startMic = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await micMedia.startCapture();
      if (!stream) {
        return false;
      }

      // Analyser セットアップ
      const { analyser, audioContext } = setupAnalyser(stream);
      micAnalyserRef.current = analyser;
      micAudioContextRef.current = audioContext;

      // ChunkManager セットアップ
      micChunkManagerRef.current = new AudioChunkManager({
        audioSource: "browser-mic",
        onChunkSent: (metadata: BrowserRecordingChunkMetadata) => {
          setState((prev) => ({
            ...prev,
            lastChunkTime: new Date(metadata.endTime),
          }));
        },
        onError: (error: Error) => {
          setState((prev) => ({ ...prev, error }));
        },
      });

      micChunkManagerRef.current.start(stream);

      setState((prev) => ({
        ...prev,
        micRecording: true,
        startedAt: prev.startedAt ?? new Date(),
        error: null,
      }));

      // レベル更新開始
      if (!animationFrameRef.current) {
        updateLevels();
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState((prev) => ({ ...prev, error }));
      return false;
    }
  }, [micMedia, setupAnalyser, updateLevels]);

  const stopMic = useCallback(async (): Promise<void> => {
    try {
      if (micChunkManagerRef.current) {
        await micChunkManagerRef.current.stop();
        micChunkManagerRef.current = null;
      }
    } catch (e) {
      console.error("stopMic: ChunkManager stop error", e);
    }

    try {
      micMedia.stopCapture();
    } catch (e) {
      console.error("stopMic: stopCapture error", e);
    }
    micAnalyserRef.current = null;

    try {
      if (micAudioContextRef.current) {
        await micAudioContextRef.current.close();
        micAudioContextRef.current = null;
      }
    } catch (e) {
      console.error("stopMic: AudioContext close error", e);
    }

    setState((prev) => ({
      ...prev,
      micRecording: false,
      micLevel: 0,
      startedAt: prev.systemRecording ? prev.startedAt : null,
    }));
  }, [micMedia]);

  const startSystem = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await systemMedia.startCapture();
      if (!stream) {
        setState((prev) => ({
          ...prev,
          error: new Error(
            "システム音声の取得に失敗しました。画面共有ダイアログで「システム音声を共有」を有効にしてください。",
          ),
        }));
        return false;
      }

      // Analyser セットアップ
      const { analyser, audioContext } = setupAnalyser(stream);
      systemAnalyserRef.current = analyser;
      systemAudioContextRef.current = audioContext;

      // ChunkManager セットアップ
      systemChunkManagerRef.current = new AudioChunkManager({
        audioSource: "browser-system",
        onChunkSent: (metadata: BrowserRecordingChunkMetadata) => {
          setState((prev) => ({
            ...prev,
            lastChunkTime: new Date(metadata.endTime),
          }));
        },
        onError: (error: Error) => {
          setState((prev) => ({ ...prev, error }));
        },
      });

      systemChunkManagerRef.current.start(stream);

      setState((prev) => ({
        ...prev,
        systemRecording: true,
        startedAt: prev.startedAt ?? new Date(),
        error: null,
      }));

      // レベル更新開始
      if (!animationFrameRef.current) {
        updateLevels();
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState((prev) => ({ ...prev, error }));
      return false;
    }
  }, [systemMedia, setupAnalyser, updateLevels]);

  const stopSystem = useCallback(async (): Promise<void> => {
    try {
      if (systemChunkManagerRef.current) {
        await systemChunkManagerRef.current.stop();
        systemChunkManagerRef.current = null;
      }
    } catch (e) {
      console.error("stopSystem: ChunkManager stop error", e);
    }

    try {
      systemMedia.stopCapture();
    } catch (e) {
      console.error("stopSystem: stopCapture error", e);
    }
    systemAnalyserRef.current = null;

    try {
      if (systemAudioContextRef.current) {
        await systemAudioContextRef.current.close();
        systemAudioContextRef.current = null;
      }
    } catch (e) {
      console.error("stopSystem: AudioContext close error", e);
    }

    setState((prev) => ({
      ...prev,
      systemRecording: false,
      systemLevel: 0,
      startedAt: prev.micRecording ? prev.startedAt : null,
    }));
  }, [systemMedia]);

  const stopAll = useCallback(async (): Promise<void> => {
    await Promise.all([stopMic(), stopSystem()]);
    setState((prev) => ({
      ...prev,
      startedAt: null,
    }));
  }, [stopMic, stopSystem]);

  return {
    ...state,
    startMic,
    stopMic,
    startSystem,
    stopSystem,
    stopAll,
  };
}
