import { Hono } from "hono";
import type { AudioCapture } from "../../audio/capture.js";

export function createRecordingRouter(capture: AudioCapture) {
  const router = new Hono();

  router.get("/", (c) => {
    return c.json({ recording: capture.isRunning() });
  });

  router.post("/", async (c) => {
    const body = await c.req.json<{ recording: boolean }>();

    if (body.recording) {
      if (!capture.isRunning()) {
        await capture.start();
      }
    } else {
      if (capture.isRunning()) {
        await capture.stop();
      }
    }

    return c.json({ recording: capture.isRunning() });
  });

  return router;
}
