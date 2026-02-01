/**
 * Rate Limit API
 *
 * レート制限の状態確認・操作
 */

import type { AdasDatabase } from "@repo/db";
import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import {
  checkRateLimit,
  cleanupOldUsage,
  estimateTokens,
  getCurrentUsage,
  getRateLimitStatus,
  recordUsage,
  updateActualTokens,
} from "../../utils/rate-limiter.js";

export function createRateLimitRouter(db: AdasDatabase) {
  const app = new Hono();

  /**
   * GET /api/rate-limit/status
   * 現在のレート制限ステータスを取得
   */
  app.get("/status", (c) => {
    const config = loadConfig();
    const status = getRateLimitStatus(db, config);
    return c.json(status);
  });

  /**
   * POST /api/rate-limit/check
   * レート制限をチェック (処理前の確認用)
   */
  app.post("/check", async (c) => {
    const body = await c.req.json<{
      processType: string;
      estimatedTokens?: number;
      inputText?: string;
    }>();

    const config = loadConfig();

    // estimatedTokens または inputText からトークン数を算出
    const tokens = body.estimatedTokens ?? (body.inputText ? estimateTokens(body.inputText) : 0);

    const result = checkRateLimit(db, config, body.processType, tokens);

    return c.json({
      allowed: result.allowed,
      reason: result.reason,
      retryAfterMs: result.retryAfterMs,
      currentUsage: result.currentUsage,
    });
  });

  /**
   * POST /api/rate-limit/record
   * 使用量を記録 (事前記録用)
   */
  app.post("/record", async (c) => {
    const body = await c.req.json<{
      processType: string;
      estimatedTokens?: number;
      inputText?: string;
      model?: string;
    }>();

    // estimatedTokens または inputText からトークン数を算出
    const tokens = body.estimatedTokens ?? (body.inputText ? estimateTokens(body.inputText) : 0);

    const usageId = recordUsage(db, body.processType, tokens, body.model);

    return c.json({ usageId });
  });

  /**
   * POST /api/rate-limit/report
   * 実際のトークン数を報告
   */
  app.post("/report", async (c) => {
    const body = await c.req.json<{
      usageId: number;
      actualTokens: number;
    }>();

    updateActualTokens(db, body.usageId, body.actualTokens);

    return c.json({ success: true });
  });

  /**
   * POST /api/rate-limit/cleanup
   * 古い使用量レコードをクリーンアップ
   */
  app.post("/cleanup", (c) => {
    const deleted = cleanupOldUsage(db);
    return c.json({ deleted });
  });

  /**
   * GET /api/rate-limit/usage
   * 現在の使用状況のみを取得 (軽量版)
   */
  app.get("/usage", (c) => {
    const usage = getCurrentUsage(db);
    return c.json(usage);
  });

  return app;
}
