/**
 * Learning Extractor
 *
 * Extracts learnings from various sources using AI
 */

import type { AdasDatabase, ClaudeCodeMessage, NewLearning } from "@repo/db";
import { schema } from "@repo/db";
import type { LearningCategory, LearningSourceType } from "@repo/types";
import consola from "consola";
import { and, eq } from "drizzle-orm";
import type { AdasConfig } from "../config.js";
import {
  type ExtractionSourceType,
  hasExtractionLog,
  recordExtractionLog,
} from "../utils/extraction-log.js";
import { findProjectByPath } from "../utils/project-lookup.js";
import { getVocabularyTerms } from "../utils/vocabulary.js";

/** Map LearningSourceType to ExtractionSourceType */
function toExtractionSourceType(sourceType: LearningSourceType): ExtractionSourceType {
  if (sourceType === "slack-message") return "slack";
  return sourceType;
}

/** ユーザープロフィール情報 (学び抽出時に参照) */
export interface UserProfileContext {
  experienceYears?: number;
  specialties?: string[];
  knownTechnologies?: string[];
  learningGoals?: string[];
}

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
 * Extract learnings from Claude Code session messages and save to DB
 */
export async function extractAndSaveLearnings(
  db: AdasDatabase,
  config: AdasConfig,
  sessionId: string,
  date: string,
  messages: ClaudeCodeMessage[],
  projectName?: string,
  userProfile?: UserProfileContext,
  projectPath?: string,
): Promise<{ extracted: number; saved: number }> {
  if (messages.length === 0) {
    return { extracted: 0, saved: 0 };
  }

  // Check if learnings already exist for this session
  const existingLearnings = db
    .select()
    .from(schema.learnings)
    .where(
      and(eq(schema.learnings.sourceType, "claude-code"), eq(schema.learnings.sourceId, sessionId)),
    )
    .all();

  if (existingLearnings.length > 0) {
    consola.debug(`[extractor] Learnings already exist for session ${sessionId}, skipping`);
    return { extracted: 0, saved: 0 };
  }

  // プロジェクト紐付け (projectPath から)
  let projectId: number | null = null;
  if (projectPath) {
    projectId = findProjectByPath(db, projectPath);
  }

  // プロフィール情報を取得 (引数で渡されていない場合はDBから取得)
  let profileContext = userProfile;
  if (!profileContext) {
    const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

    if (profile) {
      profileContext = {
        experienceYears: profile.experienceYears ?? undefined,
        specialties: profile.specialties ? JSON.parse(profile.specialties) : undefined,
        knownTechnologies: profile.knownTechnologies
          ? JSON.parse(profile.knownTechnologies)
          : undefined,
        learningGoals: profile.learningGoals ? JSON.parse(profile.learningGoals) : undefined,
      };
    }
  }

  // Format messages for extraction
  const formattedMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return extractAndSaveLearningsFromContent(
    db,
    config,
    "claude-code",
    sessionId,
    date,
    formattedMessages,
    { projectName, userProfile: profileContext, projectId },
  );
}

/**
 * Generic function to extract learnings from content and save to DB
 */
export async function extractAndSaveLearningsFromContent(
  db: AdasDatabase,
  config: AdasConfig,
  sourceType: LearningSourceType,
  sourceId: string,
  date: string,
  messages: Array<{ role: string; content: string }>,
  context?: {
    projectName?: string;
    contextInfo?: string;
    userProfile?: UserProfileContext;
    projectId?: number | null;
  },
): Promise<{ extracted: number; saved: number }> {
  if (messages.length === 0) {
    return { extracted: 0, saved: 0 };
  }

  // Check if this source has already been processed
  const extractionSourceType = toExtractionSourceType(sourceType);
  if (hasExtractionLog(db, "learning", extractionSourceType, sourceId)) {
    consola.debug(`[extractor] Source already processed: ${sourceType}:${sourceId}, skipping`);
    return { extracted: 0, saved: 0 };
  }

  const { url, timeout } = config.worker;

  // vocabulary を取得
  const vocabulary = getVocabularyTerms(db);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${url}/rpc/extract-learnings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        sourceType,
        projectName: context?.projectName,
        contextInfo: context?.contextInfo,
        userProfile: context?.userProfile,
        vocabulary,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      consola.warn(`[extractor] Worker returned ${response.status} for ${sourceType}:${sourceId}`);
      return { extracted: 0, saved: 0 };
    }

    const result = (await response.json()) as ExtractLearningsResponse;
    const extracted = result.learnings.length;

    if (extracted === 0) {
      // Record extraction log even when no learnings found
      recordExtractionLog(db, "learning", extractionSourceType, sourceId, 0);
      consola.debug(`[extractor] No learnings found in ${sourceType}:${sourceId}`);
      return { extracted: 0, saved: 0 };
    }

    // Save learnings to DB with deduplication
    let saved = 0;
    let skipped = 0;
    for (const learning of result.learnings) {
      // Check for duplicate content before saving
      if (isDuplicateLearning(db, learning.content, learning.category)) {
        consola.debug(
          `[extractor] Skipping duplicate learning: "${learning.content.slice(0, 50)}..."`,
        );
        skipped++;
        continue;
      }

      const newLearning: NewLearning = {
        sourceType,
        sourceId,
        projectId: context?.projectId ?? null,
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

    if (skipped > 0) {
      consola.info(`[extractor] ${sourceType}:${sourceId}: skipped ${skipped} duplicates`);
    }

    // Record extraction log
    recordExtractionLog(db, "learning", extractionSourceType, sourceId, saved);

    consola.info(`[extractor] ${sourceType}:${sourceId}: extracted ${extracted}, saved ${saved}`);
    return { extracted, saved };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      consola.warn(`[extractor] Timeout for ${sourceType}:${sourceId}`);
    } else {
      consola.warn(`[extractor] Failed to extract learnings for ${sourceType}:${sourceId}:`, err);
    }
    return { extracted: 0, saved: 0 };
  }
}

/**
 * Check if learnings already exist for a source
 */
export function hasExistingLearnings(
  db: AdasDatabase,
  sourceType: LearningSourceType,
  sourceId: string,
): boolean {
  const existing = db
    .select()
    .from(schema.learnings)
    .where(
      and(eq(schema.learnings.sourceType, sourceType), eq(schema.learnings.sourceId, sourceId)),
    )
    .limit(1)
    .all();

  return existing.length > 0;
}

/**
 * Check if a learning with similar content already exists
 *
 * Uses two-step deduplication:
 * 1. Exact match: Same content text
 * 2. Fuzzy match: Same category with high similarity (normalized content)
 */
export function isDuplicateLearning(
  db: AdasDatabase,
  content: string,
  category: string | null,
): boolean {
  // Step 1: Exact match
  const exactMatch = db
    .select()
    .from(schema.learnings)
    .where(eq(schema.learnings.content, content))
    .limit(1)
    .all();

  if (exactMatch.length > 0) {
    consola.debug(`[extractor] Duplicate found (exact match): "${content.slice(0, 50)}..."`);
    return true;
  }

  // Step 2: Fuzzy match - normalize and compare within same category
  const normalizedContent = normalizeContent(content);

  if (category) {
    const sameCategoryLearnings = db
      .select({ content: schema.learnings.content })
      .from(schema.learnings)
      .where(eq(schema.learnings.category, category))
      .all();

    for (const existing of sameCategoryLearnings) {
      const existingNormalized = normalizeContent(existing.content);
      if (isSimilarContent(normalizedContent, existingNormalized)) {
        consola.debug(
          `[extractor] Duplicate found (similar content): "${content.slice(0, 50)}..."`,
        );
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalize content for comparison
 * - Lowercase
 * - Remove extra whitespace
 * - Remove punctuation
 */
function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[。、．，！？!?.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if two normalized contents are similar
 * Uses simple keyword overlap ratio
 */
function isSimilarContent(a: string, b: string, threshold = 0.8): boolean {
  const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) {
    return false;
  }

  // Calculate Jaccard similarity
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  const similarity = intersection.size / union.size;

  return similarity >= threshold;
}
