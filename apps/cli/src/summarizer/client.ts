import Anthropic from "@anthropic-ai/sdk";
import consola from "consola";

const MODEL = "claude-sonnet-4-20250514";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export function getModelName(): string {
  return MODEL;
}

export async function generateSummary(prompt: string): Promise<string> {
  const anthropic = getClient();

  consola.debug("Sending request to Claude API...");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude API");
  }

  return textBlock.text;
}
