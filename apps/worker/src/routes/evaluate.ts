import { runClaude } from "@repo/core";
import type { RpcEvaluateRequest, RpcEvaluateResponse } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";

const EVALUATOR_MODEL = "haiku";

export function createEvaluateRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<RpcEvaluateRequest>();

      if (!body.text || !body.segments) {
        return c.json({ error: "text and segments are required" }, 400);
      }

      const result = await evaluateWithClaude(body.text, body.segments);
      return c.json(result);
    } catch (err) {
      consola.error("[worker/evaluate] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function evaluateWithClaude(
  text: string,
  segments: RpcEvaluateRequest["segments"],
): Promise<RpcEvaluateResponse> {
  const segmentTexts = segments.map((s) => s.text).join("\n");
  const prompt = `You are a transcription quality evaluator for Whisper speech-to-text output.

Analyze the following transcription and determine if it is a hallucination (noise/silence misinterpreted as speech) or legitimate speech content.

Common Whisper hallucination patterns:
- Repetitive phrases (e.g., "Thank you for watching" repeated)
- Generic filler phrases with no real content
- Subtitling artifacts or channel subscription prompts
- Very short meaningless utterances repeated

Full text:
${text}

Segments:
${segmentTexts}

Respond ONLY with a JSON object (no markdown, no code blocks):
{
  "judgment": "hallucination" | "legitimate",
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "suggestedPattern": "regex pattern string if hallucination, null if legitimate"
}`;

  consola.info(
    `[worker/evaluate] Evaluating transcription (${text.length} chars, ${segments.length} segments)...`,
  );

  const result = await runClaude(prompt, {
    model: EVALUATOR_MODEL,
    systemPrompt:
      "You are a transcription quality evaluator. Respond ONLY with a valid JSON object. No markdown, no explanation, no code blocks.",
    disableTools: true,
  });

  if (!result) {
    throw new Error("No response from evaluator");
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse evaluator response: ${result}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as RpcEvaluateResponse;

  // suggestedPattern の妥当性を検証
  if (parsed.suggestedPattern) {
    try {
      new RegExp(parsed.suggestedPattern);
    } catch {
      consola.debug(`Invalid regex from evaluator: ${parsed.suggestedPattern}`);
      parsed.suggestedPattern = null;
    }
  }

  consola.info(
    `[worker/evaluate] Result: ${parsed.judgment} (confidence: ${parsed.confidence}) - ${parsed.reason}`,
  );

  return parsed;
}
