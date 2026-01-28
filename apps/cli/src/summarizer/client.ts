import type { RpcSummarizeResponse } from "@repo/types";
import consola from "consola";
import { loadConfig } from "../config.js";

const MODEL = "sonnet";

export function getModelName(): string {
  return MODEL;
}

export async function generateSummary(prompt: string): Promise<string> {
  const config = loadConfig();
  const { url, timeout } = config.worker;

  consola.info(`[worker] Sending summarization to ${url}/rpc/summarize`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/rpc/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model: MODEL }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Worker returned ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as RpcSummarizeResponse;

    if (!result.content) {
      throw new Error("No content in worker response");
    }

    return result.content;
  } finally {
    clearTimeout(timeoutId);
  }
}
