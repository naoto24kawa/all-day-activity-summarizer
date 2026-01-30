import { runClaude } from "@repo/core";
import type { RpcSummarizeRequest, RpcSummarizeResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { withProcessingLog } from "../utils/log-processing.js";

export function createSummarizeRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<RpcSummarizeRequest>();

      if (!body.prompt) {
        return c.json({ error: "prompt is required" }, 400);
      }

      const model = body.model ?? "sonnet";

      consola.info(`[worker/summarize] Running claude (model: ${model})...`);

      const inputSize = body.prompt.length;
      const result = await withProcessingLog(
        "summarize",
        model,
        () => runClaude(body.prompt, { model }),
        (res) => ({
          inputSize,
          outputSize: res?.length ?? 0,
        }),
      );

      return c.json({ content: result } satisfies RpcSummarizeResponse);
    } catch (err) {
      consola.error("[worker/summarize] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}
