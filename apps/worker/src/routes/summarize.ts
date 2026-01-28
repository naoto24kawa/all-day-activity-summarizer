import { runClaude } from "@repo/core";
import type { RpcSummarizeRequest, RpcSummarizeResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";

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

      const result = await runClaude(body.prompt, {
        model,
      });

      return c.json({ content: result } satisfies RpcSummarizeResponse);
    } catch (err) {
      consola.error("[worker/summarize] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}
