import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AudioCapture } from "../../audio/capture.js";
import {
  AudioLevelMonitor,
  getAllLevels,
  getMonitor,
  removeMonitor,
  setMonitor,
} from "../../audio/level-monitor.js";

interface RecordingCaptures {
  mic?: AudioCapture;
  speaker?: AudioCapture;
}

interface CaptureConfig {
  mic?: { source: string };
  speaker?: { source: string };
}

export function createRecordingRouter(captures: RecordingCaptures, config?: CaptureConfig) {
  const router = new Hono();

  router.get("/", (c) => {
    return c.json({
      mic: captures.mic ? captures.mic.isRunning() : null,
      speaker: captures.speaker ? captures.speaker.isRunning() : null,
    });
  });

  // SSE endpoint for real-time audio levels
  router.get("/levels", (c) => {
    return streamSSE(c, async (stream) => {
      let id = 0;
      const interval = setInterval(async () => {
        const levels = getAllLevels();
        await stream.writeSSE({
          data: JSON.stringify(levels),
          event: "levels",
          id: String(id++),
        });
      }, 50); // 20 updates per second

      stream.onAbort(() => {
        clearInterval(interval);
      });

      // Keep connection alive
      while (true) {
        await stream.sleep(1000);
      }
    });
  });

  router.post("/mic", async (c) => {
    if (!captures.mic) {
      return c.json({ error: "Mic capture not configured" }, 404);
    }
    const body = await c.req.json<{ recording: boolean }>();
    if (body.recording) {
      if (!captures.mic.isRunning()) {
        await captures.mic.start();
        // Start level monitor
        if (config?.mic?.source) {
          const monitor = new AudioLevelMonitor({
            source: config.mic.source,
            type: "mic",
          });
          setMonitor("mic", monitor);
          await monitor.start();
        }
      }
    } else {
      if (captures.mic.isRunning()) {
        await captures.mic.stop();
        // Stop level monitor
        const monitor = getMonitor("mic");
        if (monitor) {
          await monitor.stop();
          removeMonitor("mic");
        }
      }
    }
    return c.json({ recording: captures.mic.isRunning() });
  });

  router.post("/speaker", async (c) => {
    if (!captures.speaker) {
      return c.json({ error: "Speaker capture not configured" }, 404);
    }
    const body = await c.req.json<{ recording: boolean }>();
    if (body.recording) {
      if (!captures.speaker.isRunning()) {
        await captures.speaker.start();
        // Start level monitor
        if (config?.speaker?.source) {
          const monitor = new AudioLevelMonitor({
            source: config.speaker.source,
            type: "speaker",
          });
          setMonitor("speaker", monitor);
          await monitor.start();
        }
      }
    } else {
      if (captures.speaker.isRunning()) {
        await captures.speaker.stop();
        // Stop level monitor
        const monitor = getMonitor("speaker");
        if (monitor) {
          await monitor.stop();
          removeMonitor("speaker");
        }
      }
    }
    return c.json({ recording: captures.speaker.isRunning() });
  });

  return router;
}
