import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdasDatabase } from "@repo/db";
import type { BrowserRecordingChunkMetadata, BrowserRecordingChunkResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { convertWebmToWav } from "../../audio/webm-converter.js";
import { processChunkComplete } from "../../audio/process-chunk.js";
import type { AdasConfig } from "../../config.js";

export function createBrowserRecordingRouter(db: AdasDatabase, config: AdasConfig) {
  const router = new Hono();

  /**
   * POST /chunk
   * ブラウザから録音された音声チャンクを受け取り、処理する。
   *
   * multipart/form-data:
   * - audio: WebM Blob (audio/webm)
   * - metadata: JSON string (BrowserRecordingChunkMetadata)
   */
  router.post("/chunk", async (c) => {
    try {
      const formData = await c.req.formData();
      const audioFile = formData.get("audio");
      const metadataStr = formData.get("metadata");

      if (!audioFile || !(audioFile instanceof File)) {
        return c.json<BrowserRecordingChunkResponse>(
          { success: false, error: "Missing audio file" },
          400,
        );
      }

      if (!metadataStr || typeof metadataStr !== "string") {
        return c.json<BrowserRecordingChunkResponse>(
          { success: false, error: "Missing metadata" },
          400,
        );
      }

      let metadata: BrowserRecordingChunkMetadata;
      try {
        metadata = JSON.parse(metadataStr);
      } catch {
        return c.json<BrowserRecordingChunkResponse>(
          { success: false, error: "Invalid metadata JSON" },
          400,
        );
      }

      // 日付ディレクトリを作成
      const dateDir = join(config.recordingsDir, metadata.date);
      if (!existsSync(dateDir)) {
        mkdirSync(dateDir, { recursive: true });
      }

      // 開始時刻からファイル名を生成
      const startTime = new Date(metadata.startTime);
      const timeStr = startTime.toTimeString().split(" ")[0]?.replace(/:/g, "-") ?? "unknown";
      const sourceType = metadata.audioSource === "browser-mic" ? "mic" : "speaker";

      // 一時 WebM ファイルを保存
      const webmPath = join(dateDir, `chunk_${timeStr}_${sourceType}.webm`);
      const wavPath = join(dateDir, `chunk_${timeStr}_${sourceType}.wav`);

      const arrayBuffer = await audioFile.arrayBuffer();
      writeFileSync(webmPath, Buffer.from(arrayBuffer));

      consola.info(`Received browser audio chunk: ${webmPath} (${audioFile.size} bytes)`);

      // WebM -> WAV 変換
      await convertWebmToWav(webmPath, wavPath, {
        sampleRate: config.audio.sampleRate,
        channels: config.audio.channels,
        deleteInput: true,
      });

      // 文字起こし処理(既存パイプラインを再利用)
      await processChunkComplete(wavPath, config, db, metadata.audioSource);

      return c.json<BrowserRecordingChunkResponse>({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      consola.error(`Browser recording error: ${message}`);
      return c.json<BrowserRecordingChunkResponse>({ success: false, error: message }, 500);
    }
  });

  /**
   * GET /
   * ブラウザ録音機能が有効かどうかを返す
   */
  router.get("/", (c) => {
    return c.json({
      enabled: true,
      chunkDurationMinutes: config.audio.chunkDurationMinutes,
    });
  });

  return router;
}
