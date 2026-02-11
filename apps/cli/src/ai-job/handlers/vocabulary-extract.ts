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
import type {
  ExtractedTerm,
  RpcTokenizeResponse,
  VocabularySuggestionSourceType,
} from "@repo/types";
import consola from "consola";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";
import { type ExtractionSourceType, recordExtractionLog } from "../../utils/extraction-log.js";
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
    case "notion":
      return handleNotionVocabularyExtract(db, config, date, limit);
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
  // 処理済みメッセージIDを取得
  const processedIds = getProcessedSourceIds(db, "slack");

  const messages = db
    .select()
    .from(schema.slackMessages)
    .where(
      processedIds.length > 0
        ? and(
            eq(schema.slackMessages.date, date),
            notInArray(schema.slackMessages.id, processedIds),
          )
        : eq(schema.slackMessages.date, date),
    )
    .orderBy(desc(schema.slackMessages.id))
    .limit(limit)
    .all();

  if (messages.length === 0) {
    return {
      success: true,
      resultSummary: "対象メッセージがありません (処理済み含む)",
      data: { extracted: 0, skippedDuplicate: 0, tasksCreated: 0, skippedProcessed: 0 },
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

  // 処理済みとして記録
  for (const msg of messages) {
    recordExtractionLog(db, "vocabulary", "slack", String(msg.id), 0);
  }

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
  // 処理済みIDを取得
  const processedItemIds = getProcessedSourceIds(db, "github");
  const processedCommentIds = getProcessedSourceIds(db, "github-comment");

  const comments = db
    .select()
    .from(schema.githubComments)
    .where(
      processedCommentIds.length > 0
        ? and(
            eq(schema.githubComments.date, date),
            notInArray(schema.githubComments.id, processedCommentIds),
          )
        : eq(schema.githubComments.date, date),
    )
    .orderBy(desc(schema.githubComments.id))
    .limit(limit)
    .all();

  const items = db
    .select()
    .from(schema.githubItems)
    .where(
      processedItemIds.length > 0
        ? and(
            eq(schema.githubItems.date, date),
            notInArray(schema.githubItems.id, processedItemIds),
          )
        : eq(schema.githubItems.date, date),
    )
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
      resultSummary: "対象コンテンツがありません (処理済み含む)",
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

  // 処理済みとして記録
  for (const item of items) {
    recordExtractionLog(db, "vocabulary", "github", String(item.id), 0);
  }
  for (const comment of comments) {
    recordExtractionLog(db, "vocabulary", "github-comment", String(comment.id), 0);
  }

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
  // 処理済みメッセージIDを取得
  const processedIds = getProcessedSourceIds(db, "claude-code");

  const messages = db
    .select()
    .from(schema.claudeCodeMessages)
    .where(
      processedIds.length > 0
        ? and(
            eq(schema.claudeCodeMessages.date, date),
            notInArray(schema.claudeCodeMessages.id, processedIds),
          )
        : eq(schema.claudeCodeMessages.date, date),
    )
    .orderBy(desc(schema.claudeCodeMessages.id))
    .limit(limit)
    .all();

  if (messages.length === 0) {
    return {
      success: true,
      resultSummary: "対象メッセージがありません (処理済み含む)",
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

  // 処理済みとして記録
  for (const msg of messages) {
    recordExtractionLog(db, "vocabulary", "claude-code", String(msg.id), 0);
  }

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
  // 処理済みメモIDを取得
  const processedIds = getProcessedSourceIds(db, "memo");

  const memos = db
    .select()
    .from(schema.memos)
    .where(
      processedIds.length > 0
        ? and(eq(schema.memos.date, date), notInArray(schema.memos.id, processedIds))
        : eq(schema.memos.date, date),
    )
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

  // 処理済みとして記録
  for (const memo of memos) {
    recordExtractionLog(db, "vocabulary", "memo", String(memo.id), 0);
  }

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
 * Notion アイテムからの用語抽出
 */
async function handleNotionVocabularyExtract(
  db: AdasDatabase,
  config: AdasConfig,
  date: string,
  limit: number,
): Promise<JobResult> {
  // 処理済みIDを取得
  const processedIds = getProcessedSourceIds(db, "notion");

  const items = db
    .select()
    .from(schema.notionItems)
    .where(
      processedIds.length > 0
        ? and(eq(schema.notionItems.date, date), notInArray(schema.notionItems.id, processedIds))
        : eq(schema.notionItems.date, date),
    )
    .orderBy(desc(schema.notionItems.id))
    .limit(limit)
    .all();

  if (items.length === 0) {
    return {
      success: true,
      resultSummary: "対象 Notion アイテムがありません (処理済み含む)",
      data: { extracted: 0, skippedDuplicate: 0, tasksCreated: 0 },
    };
  }

  const texts: string[] = [];
  for (const item of items) {
    texts.push(item.title);
    if (item.content) texts.push(item.content.substring(0, 2000));
  }

  const combinedText = texts.join("\n\n");

  const result = await extractAndSaveTerms(
    db,
    config,
    combinedText,
    "notion",
    items[0]?.id ?? null,
    date,
  );

  // 処理済みとして記録
  for (const item of items) {
    recordExtractionLog(db, "vocabulary", "notion", String(item.id), 0);
  }

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

/**
 * 処理済みソースIDを取得
 */
function getProcessedSourceIds(db: AdasDatabase, sourceType: ExtractionSourceType): number[] {
  const logs = db
    .select({ sourceId: schema.extractionLogs.sourceId })
    .from(schema.extractionLogs)
    .where(
      and(
        eq(schema.extractionLogs.extractionType, "vocabulary"),
        eq(schema.extractionLogs.sourceType, sourceType),
      ),
    )
    .all();

  return logs.map((l) => Number.parseInt(l.sourceId, 10)).filter((id) => !Number.isNaN(id));
}

interface ExtractTermsResult {
  extracted: number;
  skippedDuplicate: number;
  tasksCreated: number;
}

/**
 * 用語抽出のハイブリッド処理
 *
 * 1. local-worker で形態素解析 → 候補リスト生成
 * 2. ai-worker で AI 精査 → 最終リスト
 */
async function extractAndSaveTerms(
  db: AdasDatabase,
  config: AdasConfig,
  text: string,
  sourceType: VocabularySuggestionSourceType,
  sourceId: number | null,
  date: string,
): Promise<ExtractTermsResult> {
  // 既存の用語を取得 (vocabulary + 全 suggestions)
  // - vocabulary: 登録済み用語
  // - suggestions (全ステータス): pending, accepted, rejected すべて除外
  //   → rejected を除外しないと、却下済み用語が再度提案される
  const existingVocabulary = db
    .select({ term: schema.vocabulary.term })
    .from(schema.vocabulary)
    .all();
  const allSuggestions = db
    .select({ term: schema.vocabularySuggestions.term })
    .from(schema.vocabularySuggestions)
    .all();

  const existingTerms = [
    ...existingVocabulary.map((v) => v.term),
    ...allSuggestions.map((s) => s.term),
  ];

  consola.info(`[vocabulary/extract] Extracting from ${sourceType} (${text.length} chars)...`);

  try {
    // Step 1: local-worker で形態素解析
    let candidates: RpcTokenizeResponse["candidates"] = [];

    try {
      const tokenizeUrl = `${config.localWorker.url}/rpc/tokenize`;
      consola.info(`[vocabulary/extract] Step 1: Tokenizing with local-worker...`);

      const tokenizeResponse = await fetch(tokenizeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, existingTerms }),
        signal: AbortSignal.timeout(config.localWorker.timeout),
      });

      if (tokenizeResponse.ok) {
        const tokenizeResult = (await tokenizeResponse.json()) as RpcTokenizeResponse;
        candidates = tokenizeResult.candidates ?? [];
        consola.info(`[vocabulary/extract] Tokenizer returned ${candidates.length} candidates`);
      } else {
        consola.warn(
          `[vocabulary/extract] Tokenizer error: ${tokenizeResponse.status}, falling back to AI-only`,
        );
      }
    } catch (tokenizeErr) {
      consola.warn(
        `[vocabulary/extract] Tokenizer unavailable, falling back to AI-only:`,
        tokenizeErr instanceof Error ? tokenizeErr.message : tokenizeErr,
      );
    }

    // 候補が0件の場合は AI をスキップ (コスト削減)
    if (candidates.length === 0) {
      consola.info(`[vocabulary/extract] No candidates from tokenizer, skipping AI`);
      return { extracted: 0, skippedDuplicate: 0, tasksCreated: 0 };
    }

    // Step 2: ai-worker で AI 精査
    const aiWorkerUrl = `${config.worker.url}/rpc/extract-terms`;
    consola.info(
      `[vocabulary/extract] Step 2: Refining ${candidates.length} candidates with ai-worker...`,
    );

    const aiResponse = await fetch(aiWorkerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates,
        sourceType,
      }),
      signal: AbortSignal.timeout(config.worker.timeout),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI Worker error: ${aiResponse.status} ${aiResponse.statusText}`);
    }

    const result = (await aiResponse.json()) as { extractedTerms: ExtractedTerm[] };
    const extractedTerms = result.extractedTerms ?? [];

    consola.info(`[vocabulary/extract] AI Worker returned ${extractedTerms.length} terms`);

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
          title: term.term,
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
