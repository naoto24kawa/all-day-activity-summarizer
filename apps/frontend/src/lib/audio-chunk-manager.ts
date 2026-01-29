import type { BrowserRecordingChunkMetadata, BrowserRecordingChunkResponse } from "@repo/types";
import { postFormDataAdasApi } from "./adas-api";
import { getDateString } from "./date";

export type AudioSourceType = "browser-mic" | "browser-system";

export interface ChunkManagerOptions {
  /** チャンク分割間隔(ミリ秒) */
  chunkIntervalMs?: number;
  /** MediaRecorder の mimeType */
  mimeType?: string;
  /** 音声ソースタイプ */
  audioSource: AudioSourceType;
  /** チャンク送信成功時のコールバック */
  onChunkSent?: (metadata: BrowserRecordingChunkMetadata) => void;
  /** エラー時のコールバック */
  onError?: (error: Error) => void;
}

/**
 * MediaRecorder からの音声データを収集し、定期的にサーバーに送信するマネージャー。
 */
export class AudioChunkManager {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private chunkStartTime: Date | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private readonly chunkIntervalMs: number;
  private readonly mimeType: string;
  private readonly audioSource: AudioSourceType;
  private readonly onChunkSent?: (metadata: BrowserRecordingChunkMetadata) => void;
  private readonly onError?: (error: Error) => void;

  constructor(options: ChunkManagerOptions) {
    this.chunkIntervalMs = options.chunkIntervalMs ?? 2 * 60 * 1000; // デフォルト 2分(タイムアウト対策)
    this.audioSource = options.audioSource;
    this.onChunkSent = options.onChunkSent;
    this.onError = options.onError;

    // MediaRecorder がサポートする mimeType を選択
    this.mimeType = options.mimeType ?? this.selectMimeType();
  }

  private selectMimeType(): string {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];

    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    // フォールバック
    return "audio/webm";
  }

  /**
   * 録音を開始する
   */
  start(stream: MediaStream): void {
    if (this.recorder) {
      console.warn("AudioChunkManager: Already recording");
      return;
    }

    try {
      this.recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
    } catch (_err) {
      // mimeType がサポートされていない場合はデフォルトで試す
      this.recorder = new MediaRecorder(stream);
    }

    this.chunks = [];
    this.chunkStartTime = new Date();

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.recorder.onerror = (event) => {
      const error = new Error(`MediaRecorder error: ${event.type}`);
      this.onError?.(error);
    };

    // 1秒ごとにデータを取得(timeslice)
    this.recorder.start(1000);

    // チャンク送信タイマー
    this.intervalId = setInterval(() => {
      this.sendCurrentChunk();
    }, this.chunkIntervalMs);
  }

  /**
   * 録音を停止し、残りのデータを送信する
   */
  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }

    // 最後のチャンクを送信（バックグラウンドで実行、await しない）
    this.sendCurrentChunk().catch((err) => {
      console.error("AudioChunkManager: Failed to send final chunk", err);
    });

    this.recorder = null;
    this.chunks = [];
    this.chunkStartTime = null;
  }

  /**
   * 現在のチャンクをサーバーに送信する
   */
  private async sendCurrentChunk(): Promise<void> {
    if (this.chunks.length === 0 || !this.chunkStartTime) {
      return;
    }

    const endTime = new Date();
    const blob = new Blob(this.chunks, { type: this.mimeType });

    // チャンクをリセット
    const startTime = this.chunkStartTime;
    this.chunks = [];
    this.chunkStartTime = new Date();

    // 小さすぎるチャンクはスキップ(1KB未満)
    if (blob.size < 1024) {
      console.debug("AudioChunkManager: Skipping small chunk", blob.size);
      return;
    }

    const metadata: BrowserRecordingChunkMetadata = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      audioSource: this.audioSource,
      date: getDateString(startTime),
    };

    try {
      const formData = new FormData();
      formData.append("audio", blob, `chunk.webm`);
      formData.append("metadata", JSON.stringify(metadata));

      const response = await postFormDataAdasApi<BrowserRecordingChunkResponse>(
        "/api/browser-recording/chunk",
        formData,
      );

      if (response.success) {
        this.onChunkSent?.(metadata);
      } else {
        throw new Error(response.error ?? "Unknown error");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("AudioChunkManager: Failed to send chunk", error);
      this.onError?.(error);
    }
  }

  /**
   * 録音中かどうか
   */
  isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === "recording";
  }
}
