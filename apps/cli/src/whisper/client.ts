import { readFileSync } from "node:fs";
import type { RpcTranscribeConfig, RpcTranscribeResponse } from "@repo/types";
import consola from "consola";
import type { AdasConfig } from "../config.js";

export interface WhisperSegment {
  start: number; // ms
  end: number; // ms
  text: string;
}

export interface WhisperResult {
  text: string;
  segments: WhisperSegment[];
  language: string;
}

export async function transcribeAudio(
  audioPath: string,
  config: AdasConfig,
  initialPrompt?: string,
): Promise<WhisperResult> {
  const { url, timeout } = config.localWorker;

  consola.info(`[local-worker] Sending transcription to ${url}/rpc/transcribe`);

  const formData = new FormData();

  // WAV ファイルを読み込んで送信
  const audioBuffer = readFileSync(audioPath);
  const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
  formData.append("audio", audioBlob, "audio.wav");

  // config
  const rpcConfig: RpcTranscribeConfig = {
    language: config.whisper.language,
    engine: config.whisper.engine,
    initialPrompt,
  };
  formData.append("config", JSON.stringify(rpcConfig));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/rpc/transcribe`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Worker returned ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as RpcTranscribeResponse;

    return {
      text: result.text,
      segments: result.segments.map((seg: { start: number; end: number; text: string }) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
      })),
      language: result.language,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
