import type { RpcSummarizeRequest, RpcSummarizeResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { getLLMProviderForProcess, getProviderInfo } from "../utils/llm-config.js";
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

      // LLM Provider を取得 (設定で claude/lmstudio を切り替え)
      const provider = getLLMProviderForProcess("summarize", model);
      const providerInfo = getProviderInfo("summarize");

      consola.info(
        `[worker/summarize] Running LLM (model: ${model}, provider: ${providerInfo.provider})...`,
      );

      const inputSize = body.prompt.length;
      const result = await withProcessingLog(
        "summarize",
        model,
        () =>
          provider.generate(body.prompt, {
            model,
            temperature: 0.7,
            maxTokens: 8192, // サマリは長くなる可能性があるため
          }),
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
