/**
 * Vocabulary Extract Handler
 *
 * 各種ソースから用語を抽出
 * - slack: Slack メッセージ
 * - github: GitHub コンテンツ
 * - claude-code: Claude Code セッション
 * - memo: メモ
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { ExtractedTerm, VocabularySuggestionSourceType } from "@repo/types";
import consola from "consola";
import { desc, eq } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";
import type { JobResult } from "../worker.js";

export async function handleVocabularyExtract(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const sourceType = (params.sourceType as VocabularySuggestionSourceType) ?? "slack";
  const date = (params.date as string) ?? getTodayDateString();
  const limit = (params.limit as number) ?? 50;

  switch (sourceType) {
    case "slack":
      return handleSlackVocabularyExtract(db, config, date, limit);
    case "github":
      return handleGitHubVocabularyExtract(db, config, date, limit);
    case "claude-code":
      return handleClaudeCodeVocabularyExtract(db, config, date, limit);
    case "memo":
      return handleMemoVocabularyExtract(db, config, date, limit);
    default:
      return {
        success: false,
        resultSummary: `不明なソースタイプ: ${sourceType}`,
      };
  }
}

/**
 * Slack メッセージからの用語抽出
 */
async function handleSlackVocabularyExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
  limit: number,
): Promise<JobResult> {
  const messages = db
    .select()
    .from(schema.slackMessages)
    .where(eq(schema.slackMessages.date, date))
    .orderBy(desc(schema.slackMessages.id))
    .limit(limit)
    .all();

  if (messages.length === 0) {
    return {
      success: true,
      resultSummary: "対象メッセージがありません",
      data: { extracted: 0, skippedDuplicate: 0, tasksCreated: 0 },
    };
  }

  const combinedText = messages.map((m) => m.text).join("\n\n");

  const result = await extractAndSaveTerms(
    db,
    config,
    combinedText,
    "slack",
    messages[0]?.id ?? null,
    date,
  );

  return {
    success: true,
    resultSummary:
      result.extracted > 0
        ? `${result.extracted}件の用語を抽出しました`
        : "用語は抽出されませんでした",
    data: result,
  };
}

/**
 * GitHub コンテンツからの用語抽出
 */
async function handleGitHubVocabularyExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
  limit: number,
): Promise<JobResult> {
  const comments = db
    .select()
    .from(schema.githubComments)
    .where(eq(schema.githubComments.date, date))
    .orderBy(desc(schema.githubComments.id))
    .limit(limit)
    .all();

  const items = db
    .select()
    .from(schema.githubItems)
    .where(eq(schema.githubItems.date, date))
    .orderBy(desc(schema.githubItems.id))
    .limit(limit)
    .all();

  const texts: string[] = [];
  for (const item of items) {
    texts.push(`[${item.itemType}] ${item.title}`);
    if (item.body) texts.push(item.body);
  }
  for (const comment of comments) {
    texts.push(comment.body);
  }

  if (texts.length === 0) {
    return {
      success: true,
      resultSummary: "対象コンテンツがありません",
      data: { extracted: 0, skippedDuplicate: 0, tasksCreated: 0 },
    };
  }

  const combinedText = texts.join("\n\n");

  const result = await extractAndSaveTerms(
    db,
    config,
    combinedText,
    "github",
    items[0]?.id ?? comments[0]?.id ?? null,
    date,
  );

  return {
    success: true,
    resultSummary:
      result.extracted > 0
        ? `${result.extracted}件の用語を抽出しました`
        : "用語は抽出されませんでした",
    data: result,
  };
}

/**
 * Claude Code セッションからの用語抽出
 */
async function handleClaudeCodeVocabularyExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
  limit: number,
): Promise<JobResult> {
  const messages = db
    .select()
    .from(schema.claudeCodeMessages)
    .where(eq(schema.claudeCodeMessages.date, date))
    .orderBy(desc(schema.claudeCodeMessages.id))
    .limit(limit)
    .all();

  if (messages.length === 0) {
    return {
      success: true,
      resultSummary: "対象メッセージがありません",
      data: { extracted: 0, skippedDuplicate: 0, tasksCreated: 0 },
    };
  }

  const combinedText = messages
    .map((m) => `[${m.role}]: ${m.content.substring(0, 2000)}`)
    .join("\n\n");

  const result = await extractAndSaveTerms(
    db,
    config,
    combinedText,
    "claude-code",
    messages[0]?.id ?? null,
    date,
  );

  return {
    success: true,
    resultSummary:
      result.extracted > 0
        ? `${result.extracted}件の用語を抽出しました`
        : "用語は抽出されませんでした",
    data: result,
  };
}

/**
 * メモからの用語抽出
 */
async function handleMemoVocabularyExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
  limit: number,
): Promise<JobResult> {
  const memos = db
    .select()
    .from(schema.memos)
    .where(eq(schema.memos.date, date))
    .orderBy(desc(schema.memos.id))
    .limit(limit)
    .all();

  if (memos.length === 0) {
    return {
      success: true,
      resultSummary: "対象メモがありません",
      data: { extracted: 0, skippedDuplicate: 0, tasksCreated: 0 },
    };
  }

  const combinedText = memos.map((m) => m.content).join("\n\n");

  const result = await extractAndSaveTerms(
    db,
    config,
    combinedText,
    "memo",
    memos[0]?.id ?? null,
    date,
  );

  return {
    success: true,
    resultSummary:
      result.extracted > 0
        ? `${result.extracted}件の用語を抽出しました`
        : "用語は抽出されませんでした",
    data: result,
  };
}

// ========== ヘルパー関数 ==========

interface ExtractTermsResult {
  extracted: number;
  skippedDuplicate: number;
  tasksCreated: number;
}

async function extractAndSaveTerms(
  db: AdasDatabase,
  config: AdasConfig,
  text: string,
  sourceType: VocabularySuggestionSourceType,
  sourceId: number | null,
  date: string,
): Promise<ExtractTermsResult> {
  // 既存の用語を取得 (vocabulary + pending suggestions)
  const existingVocabulary = db
    .select({ term: schema.vocabulary.term })
    .from(schema.vocabulary)
    .all();
  const pendingSuggestions = db
    .select({ term: schema.vocabularySuggestions.term })
    .from(schema.vocabularySuggestions)
    .where(eq(schema.vocabularySuggestions.status, "pending"))
    .all();

  const existingTerms = [
    ...existingVocabulary.map((v) => v.term),
    ...pendingSuggestions.map((s) => s.term),
  ];

  // Worker に抽出リクエスト
  const workerUrl = `${config.worker.url}/rpc/extract-terms`;

  consola.info(
    `[vocabulary/extract] Requesting extraction from ${sourceType} (${text.length} chars)...`,
  );

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        sourceType,
        existingTerms,
      }),
      signal: AbortSignal.timeout(config.worker.timeout),
    });

    if (!response.ok) {
      throw new Error(`Worker error: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as { extractedTerms: ExtractedTerm[] };
    const extractedTerms = result.extractedTerms ?? [];

    consola.info(`[vocabulary/extract] Worker returned ${extractedTerms.length} terms`);

    let extracted = 0;
    let skippedDuplicate = 0;
    let tasksCreated = 0;

    const now = new Date().toISOString();

    for (const term of extractedTerms) {
      // 重複チェック
      const isDuplicate = existingTerms.some((t) => t.toLowerCase() === term.term.toLowerCase());
      if (isDuplicate) {
        skippedDuplicate++;
        continue;
      }

      // vocabulary_suggestions に登録
      const suggestion = db
        .insert(schema.vocabularySuggestions)
        .values({
          term: term.term,
          reading: term.reading ?? null,
          category: term.category ?? null,
          reason: term.reason ?? null,
          sourceType,
          sourceId,
          confidence: term.confidence,
          status: "pending",
        })
        .returning()
        .get();

      // tasks に登録
      db.insert(schema.tasks)
        .values({
          date,
          sourceType: "vocabulary",
          vocabularySuggestionId: suggestion.id,
          title: `用語追加: ${term.term}`,
          description: term.reason ?? `${sourceType}から抽出された用語`,
          status: "pending",
          confidence: term.confidence,
          extractedAt: now,
        })
        .run();

      extracted++;
      tasksCreated++;
      existingTerms.push(term.term);
    }

    consola.info(
      `[vocabulary/extract] Done: ${extracted} extracted, ${skippedDuplicate} skipped, ${tasksCreated} tasks created`,
    );

    return { extracted, skippedDuplicate, tasksCreated };
  } catch (err) {
    consola.error(`[vocabulary/extract] Error:`, err);
    return { extracted: 0, skippedDuplicate: 0, tasksCreated: 0 };
  }
}
