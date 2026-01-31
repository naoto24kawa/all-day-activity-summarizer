import type { RpcSummarizeResponse } from "@repo/types";
import consola from "consola";
import { loadConfig } from "../config.js";

const MODEL = "sonnet";

export function getModelName(): string {
  return MODEL;
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

export async function generateSummary(prompt: string): Promise<string> {
  const config = loadConfig();
  const provider = config.summarizer.provider;

  if (provider === "lmstudio") {
    return generateSummaryWithLMStudio(prompt);
  }

  return generateSummaryWithClaude(prompt);
}
