import { Hono } from "hono";
import type { AudioCapture } from "../../audio/capture.js";

interface RecordingCaptures {
  mic?: AudioCapture;
  speaker?: AudioCapture;
}

export function createRecordingRouter(captures: RecordingCaptures) {
  const router = new Hono();

  router.get("/", (c) => {
    return c.json({
      mic: captures.mic ? captures.mic.isRunning() : null,
      speaker: captures.speaker ? captures.speaker.isRunning() : null,
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
      }
    } else {
      if (captures.mic.isRunning()) {
        await captures.mic.stop();
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
      }
    } else {
      if (captures.speaker.isRunning()) {
        await captures.speaker.stop();
      }
    }
    return c.json({ recording: captures.speaker.isRunning() });
  });

  return router;
}
