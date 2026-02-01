import type { RpcSummarizeResponse } from "@repo/types";
import consola from "consola";
import { loadConfig } from "../config.js";
import { withProcessingLog } from "../utils/ai-processing-log.js";

const DEFAULT_MODEL = "sonnet";

export function getModelName(): string {
  const config = loadConfig();
  if (config.summarizer.provider === "lmstudio") {
    return config.summarizer.lmstudio.model || "lmstudio";
  }
  return DEFAULT_MODEL;
}

interface LMStudioChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

async function generateSummaryWithLMStudio(prompt: string): Promise<string> {
  const config = loadConfig();
  const { url, model, timeout } = config.summarizer.lmstudio;

  if (!model) {
    throw new Error("LM Studio model is not configured");
  }

  consola.info(`[lmstudio] Sending summarization to ${url}/v1/chat/completions`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LM Studio returned ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as LMStudioChatResponse;

    if (!result.choices?.[0]?.message?.content) {
      throw new Error("No content in LM Studio response");
    }

    return result.choices[0].message.content;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateSummaryWithClaude(prompt: string): Promise<string> {
  const config = loadConfig();
  const { url, timeout } = config.worker;

  consola.info(`[worker] Sending summarization to ${url}/rpc/summarize`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/rpc/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model: DEFAULT_MODEL }),
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

export async function generateSummary(prompt: string): Promise<string> {
  const config = loadConfig();
  const provider = config.summarizer.provider;

  if (provider === "lmstudio") {
    const model = config.summarizer.lmstudio.model || "lmstudio";
    return withProcessingLog(
      "summarize",
      model,
      () => generateSummaryWithLMStudio(prompt),
      (result) => ({
        inputSize: prompt.length,
        outputSize: result.length,
      }),
    );
  }

  // Worker経由の場合は Worker 側でログ記録される
  return generateSummaryWithClaude(prompt);
}
