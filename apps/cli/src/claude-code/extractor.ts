/**
 * Learning Extractor
 *
 * Extracts learnings from Claude Code session messages using AI
 */

import type { AdasDatabase, ClaudeCodeMessage, NewLearning } from "@repo/db";
import { schema } from "@repo/db";
import type { LearningCategory } from "@repo/types";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../config.js";

interface ExtractedLearning {
  content: string;
  category: LearningCategory;
  tags: string[];
  confidence: number;
}

interface ExtractLearningsResponse {
  learnings: ExtractedLearning[];
}

/**
 * Extract learnings from session messages and save to DB
 */
export async function extractAndSaveLearnings(
  db: AdasDatabase,
  config: AdasConfig,
  sessionId: string,
  date: string,
  messages: ClaudeCodeMessage[],
  projectName?: string,
): Promise<{ extracted: number; saved: number }> {
  if (messages.length === 0) {
    return { extracted: 0, saved: 0 };
  }

  // Check if learnings already exist for this session
  const existingLearnings = db
    .select()
    .from(schema.learnings)
    .where(eq(schema.learnings.sessionId, sessionId))
    .all();

  if (existingLearnings.length > 0) {
    consola.debug(`[extractor] Learnings already exist for session ${sessionId}, skipping`);
    return { extracted: 0, saved: 0 };
  }

  const { url, timeout } = config.worker;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${url}/rpc/extract-learnings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        projectName,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      consola.warn(`[extractor] Worker returned ${response.status} for session ${sessionId}`);
      return { extracted: 0, saved: 0 };
    }

    const result = (await response.json()) as ExtractLearningsResponse;
    const extracted = result.learnings.length;

    if (extracted === 0) {
      consola.debug(`[extractor] No learnings found in session ${sessionId}`);
      return { extracted: 0, saved: 0 };
    }

    // Save learnings to DB
    let saved = 0;
    for (const learning of result.learnings) {
      const newLearning: NewLearning = {
        sessionId,
        date,
        content: learning.content,
        category: learning.category,
        tags: JSON.stringify(learning.tags),
        confidence: learning.confidence,
        // SM-2 defaults
        repetitionCount: 0,
        easeFactor: 2.5,
        interval: 0,
        nextReviewAt: null,
        lastReviewedAt: null,
      };

      try {
        db.insert(schema.learnings).values(newLearning).run();
        saved++;
      } catch (err) {
        consola.warn(`[extractor] Failed to save learning:`, err);
      }
    }

    consola.info(`[extractor] Session ${sessionId}: extracted ${extracted}, saved ${saved}`);
    return { extracted, saved };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      consola.warn(`[extractor] Timeout for session ${sessionId}`);
    } else {
      consola.warn(`[extractor] Failed to extract learnings for session ${sessionId}:`, err);
    }
    return { extracted: 0, saved: 0 };
  }
}
