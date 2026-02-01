/**
 * Rate Limiter Utility
 *
 * AI 処理のレート制限を管理
 * - Sliding window 方式で使用量を計算
 * - 処理タイプごとの優先度に応じた制限係数
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { gte, lte, sql } from "drizzle-orm";
import type { AdasConfig } from "../config.js";

/** 処理タイプの優先度 */
export type RateLimitPriority = "high" | "medium" | "low" | "lowest";

/** 処理タイプから優先度へのマッピング */
const PROCESS_TYPE_PRIORITY: Record<string, RateLimitPriority> = {
  // high: リアルタイム処理
  interpret: "high",
  evaluate: "high",
  transcribe: "high",

  // medium: 補助処理
  "suggest-tags": "medium",
  "match-channels": "medium",
  "extract-terms": "medium",
  "check-completion": "medium",

  // low: バッチ処理
  summarize: "low",
  "analyze-profile": "low",
  "summarize-times": "low",
  "summarize-daily": "low",

  // lowest: バックグラウンド処理
  "extract-learnings": "lowest",
  "explain-learning": "lowest",
  "task-extract-slack": "lowest",
  "task-extract-github": "lowest",
  "task-extract-github-comment": "lowest",
  "task-extract-memo": "lowest",
  "task-elaborate": "lowest",
  "learning-extract": "lowest",
  "vocabulary-extract": "lowest",
  "profile-analyze": "lowest",
};

/** レート制限チェック結果 */
export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  currentUsage: RateLimitCurrentUsage;
}

/** 現在の使用状況 */
export interface RateLimitCurrentUsage {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
}

/** 使用状況の制限に対する割合 */
export interface RateLimitUsagePercent {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
}

/** レート制限ステータス */
export interface RateLimitStatus {
  enabled: boolean;
  currentUsage: RateLimitCurrentUsage;
  limits: AdasConfig["rateLimit"]["limits"];
  usagePercent: RateLimitUsagePercent;
}

/**
 * 処理タイプから優先度を取得
 */
export function getPriority(processType: string): RateLimitPriority {
  return PROCESS_TYPE_PRIORITY[processType] ?? "medium";
}

/**
 * 使用量を集計 (sliding window)
 */
function getUsageSince(db: AdasDatabase, since: string): { requests: number; tokens: number } {
  const result = db
    .select({
      requests: sql<number>`sum(${schema.rateLimitUsage.requestCount})`,
      tokens: sql<number>`sum(coalesce(${schema.rateLimitUsage.actualTokens}, ${schema.rateLimitUsage.estimatedTokens}))`,
    })
    .from(schema.rateLimitUsage)
    .where(gte(schema.rateLimitUsage.timestamp, since))
    .get();

  return {
    requests: result?.requests ?? 0,
    tokens: result?.tokens ?? 0,
  };
}

/**
 * 現在の使用状況を取得
 */
export function getCurrentUsage(db: AdasDatabase): RateLimitCurrentUsage {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const minuteUsage = getUsageSince(db, oneMinuteAgo);
  const hourUsage = getUsageSince(db, oneHourAgo);
  const dayUsage = getUsageSince(db, oneDayAgo);

  return {
    requestsPerMinute: minuteUsage.requests,
    requestsPerHour: hourUsage.requests,
    requestsPerDay: dayUsage.requests,
    tokensPerMinute: minuteUsage.tokens,
    tokensPerHour: hourUsage.tokens,
    tokensPerDay: dayUsage.tokens,
  };
}

/**
 * レート制限をチェック
 */
export function checkRateLimit(
  db: AdasDatabase,
  config: AdasConfig,
  processType: string,
  estimatedTokens: number,
): RateLimitCheckResult {
  if (!config.rateLimit.enabled) {
    return {
      allowed: true,
      currentUsage: getCurrentUsage(db),
    };
  }

  const { limits, priorityMultipliers } = config.rateLimit;
  const priority = getPriority(processType);
  const multiplier = priorityMultipliers[priority];

  const currentUsage = getCurrentUsage(db);

  // 各制限をチェック (優先度に応じた係数を適用)
  const effectiveLimits = {
    requestsPerMinute: Math.floor(limits.requestsPerMinute * multiplier),
    requestsPerHour: Math.floor(limits.requestsPerHour * multiplier),
    requestsPerDay: Math.floor(limits.requestsPerDay * multiplier),
    tokensPerMinute: Math.floor(limits.tokensPerMinute * multiplier),
    tokensPerHour: Math.floor(limits.tokensPerHour * multiplier),
    tokensPerDay: Math.floor(limits.tokensPerDay * multiplier),
  };

  // リクエスト数チェック
  if (currentUsage.requestsPerMinute >= effectiveLimits.requestsPerMinute) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${currentUsage.requestsPerMinute}/${effectiveLimits.requestsPerMinute} requests/min`,
      retryAfterMs: 60 * 1000, // 1分後
      currentUsage,
    };
  }

  if (currentUsage.requestsPerHour >= effectiveLimits.requestsPerHour) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${currentUsage.requestsPerHour}/${effectiveLimits.requestsPerHour} requests/hour`,
      retryAfterMs: 5 * 60 * 1000, // 5分後
      currentUsage,
    };
  }

  if (currentUsage.requestsPerDay >= effectiveLimits.requestsPerDay) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${currentUsage.requestsPerDay}/${effectiveLimits.requestsPerDay} requests/day`,
      retryAfterMs: 60 * 60 * 1000, // 1時間後
      currentUsage,
    };
  }

  // トークン数チェック (事前見積もり含む)
  if (currentUsage.tokensPerMinute + estimatedTokens > effectiveLimits.tokensPerMinute) {
    return {
      allowed: false,
      reason: `Token limit exceeded: ${currentUsage.tokensPerMinute}/${effectiveLimits.tokensPerMinute} tokens/min`,
      retryAfterMs: 60 * 1000,
      currentUsage,
    };
  }

  if (currentUsage.tokensPerHour + estimatedTokens > effectiveLimits.tokensPerHour) {
    return {
      allowed: false,
      reason: `Token limit exceeded: ${currentUsage.tokensPerHour}/${effectiveLimits.tokensPerHour} tokens/hour`,
      retryAfterMs: 5 * 60 * 1000,
      currentUsage,
    };
  }

  if (currentUsage.tokensPerDay + estimatedTokens > effectiveLimits.tokensPerDay) {
    return {
      allowed: false,
      reason: `Token limit exceeded: ${currentUsage.tokensPerDay}/${effectiveLimits.tokensPerDay} tokens/day`,
      retryAfterMs: 60 * 60 * 1000,
      currentUsage,
    };
  }

  return {
    allowed: true,
    currentUsage,
  };
}

/**
 * 使用量を記録 (事前)
 */
export function recordUsage(
  db: AdasDatabase,
  processType: string,
  estimatedTokens: number,
  model?: string,
): number {
  const now = new Date().toISOString();

  const result = db
    .insert(schema.rateLimitUsage)
    .values({
      timestamp: now,
      processType,
      model: model ?? null,
      requestCount: 1,
      estimatedTokens,
      actualTokens: null,
      createdAt: now,
    })
    .returning({ id: schema.rateLimitUsage.id })
    .get();

  return result.id;
}

/**
 * 実際のトークン数を更新
 */
export function updateActualTokens(db: AdasDatabase, usageId: number, actualTokens: number): void {
  db.update(schema.rateLimitUsage)
    .set({ actualTokens })
    .where(sql`${schema.rateLimitUsage.id} = ${usageId}`)
    .run();
}

/**
 * 古い使用量レコードをクリーンアップ (24時間以上前)
 */
export function cleanupOldUsage(db: AdasDatabase): number {
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25時間前 (余裕を持たせる)

  const result = db
    .delete(schema.rateLimitUsage)
    .where(lte(schema.rateLimitUsage.timestamp, cutoff))
    .returning({ id: schema.rateLimitUsage.id })
    .all();

  return result.length;
}

/**
 * レート制限ステータスを取得
 */
export function getRateLimitStatus(db: AdasDatabase, config: AdasConfig): RateLimitStatus {
  const currentUsage = getCurrentUsage(db);
  const { limits } = config.rateLimit;

  const usagePercent: RateLimitUsagePercent = {
    requestsPerMinute:
      limits.requestsPerMinute > 0
        ? (currentUsage.requestsPerMinute / limits.requestsPerMinute) * 100
        : 0,
    requestsPerHour:
      limits.requestsPerHour > 0
        ? (currentUsage.requestsPerHour / limits.requestsPerHour) * 100
        : 0,
    requestsPerDay:
      limits.requestsPerDay > 0 ? (currentUsage.requestsPerDay / limits.requestsPerDay) * 100 : 0,
    tokensPerMinute:
      limits.tokensPerMinute > 0
        ? (currentUsage.tokensPerMinute / limits.tokensPerMinute) * 100
        : 0,
    tokensPerHour:
      limits.tokensPerHour > 0 ? (currentUsage.tokensPerHour / limits.tokensPerHour) * 100 : 0,
    tokensPerDay:
      limits.tokensPerDay > 0 ? (currentUsage.tokensPerDay / limits.tokensPerDay) * 100 : 0,
  };

  return {
    enabled: config.rateLimit.enabled,
    currentUsage,
    limits,
    usagePercent,
  };
}

/**
 * 入力文字数からトークン数を概算
 * 日本語: 1文字 ≈ 2-3トークン、英語: 1単語 ≈ 1-2トークン
 * 安全のため文字数 × 4 で計算
 */
export function estimateTokens(inputText: string): number {
  return inputText.length * 4;
}
