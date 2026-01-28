import { getPromptFilePath, runClaude } from "@repo/core";
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
  const segmentList = segments.map((s, i) => `[${i}] "${s.text}"`).join("\n");

  const prompt = `You are a transcription quality evaluator for Whisper speech-to-text output.

Analyze EACH segment individually and determine if it is a hallucination (noise/silence misinterpreted as speech) or legitimate speech content.

Common Whisper hallucination patterns:
- Repetitive phrases (e.g., "Thank you for watching" repeated)
- Generic filler phrases with no real content
- Subtitling artifacts or channel subscription prompts
- Very short meaningless utterances repeated
- Repetitive character noise (e.g., "あああああ", "えーえーえー")

Segments to evaluate:
${segmentList}

Respond ONLY with a JSON object (no markdown, no code blocks):
{
  "judgment": "hallucination" | "legitimate" | "mixed",
  "confidence": 0.0-1.0,
  "reason": "brief overall explanation",
  "suggestedPattern": "regex pattern for the most common hallucination type, or null",
  "segmentEvaluations": [
    {
      "index": 0,
      "judgment": "hallucination" | "legitimate",
      "confidence": 0.0-1.0,
      "reason": "brief explanation for this segment",
      "suggestedPattern": "regex pattern if hallucination, null if legitimate"
    }
  ]
}

Rules:
- Evaluate each segment independently
- "judgment" should be "hallucination" if ALL segments are hallucinations, "legitimate" if ALL are legitimate, "mixed" otherwise
- Include an evaluation for EVERY segment in segmentEvaluations array`;

  consola.info(
    `[worker/evaluate] Evaluating transcription (${text.length} chars, ${segments.length} segments)...`,
  );

  const result = await runClaude(prompt, {
    model: EVALUATOR_MODEL,
    appendSystemPromptFile: getPromptFilePath("evaluate"),
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

  // judgment のバリデーション: LLM が想定外の値を返す場合がある
  if (
    parsed.judgment !== "hallucination" &&
    parsed.judgment !== "legitimate" &&
    parsed.judgment !== "mixed"
  ) {
    consola.debug(
      `[worker/evaluate] Unexpected judgment value: ${parsed.judgment}, normalizing to 'legitimate'`,
    );
    parsed.judgment = "legitimate";
    parsed.suggestedPattern = null;
  }

  // suggestedPattern の妥当性を検証
  if (parsed.suggestedPattern) {
    try {
      new RegExp(parsed.suggestedPattern);
    } catch {
      consola.debug(`Invalid regex from evaluator: ${parsed.suggestedPattern}`);
      parsed.suggestedPattern = null;
    }
  }

  // segmentEvaluations のバリデーション
  if (parsed.segmentEvaluations) {
    for (const seg of parsed.segmentEvaluations) {
      if (seg.judgment !== "hallucination" && seg.judgment !== "legitimate") {
        seg.judgment = "legitimate";
        seg.suggestedPattern = null;
      }
      if (seg.suggestedPattern) {
        try {
          new RegExp(seg.suggestedPattern);
        } catch {
          consola.debug(`Invalid regex from segment evaluator: ${seg.suggestedPattern}`);
          seg.suggestedPattern = null;
        }
      }
    }
  }

  const hallucinationCount =
    parsed.segmentEvaluations?.filter((s) => s.judgment === "hallucination").length ?? 0;
  consola.info(
    `[worker/evaluate] Result: ${parsed.judgment} (${hallucinationCount}/${segments.length} hallucinations) - ${parsed.reason}`,
  );

  return parsed;
}
