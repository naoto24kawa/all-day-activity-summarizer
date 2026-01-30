/**
 * AI Processing Logs API Routes
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { AiProcessType, CreateAiProcessingLogRequest } from "@repo/types";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

export function createAiProcessingLogsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/ai-processing-logs
   *
   * Query params:
   * - date: YYYY-MM-DD (optional, defaults to today)
   * - processType: string (optional, filters by process type)
   * - status: "success" | "error" (optional)
   * - limit: number (optional, defaults to 200)
   */
  router.get("/", (c) => {
    const date = c.req.query("date");
    const processType = c.req.query("processType") as AiProcessType | undefined;
    const status = c.req.query("status") as "success" | "error" | undefined;
    const limitStr = c.req.query("limit");

    const limit = limitStr ? Number.parseInt(limitStr, 10) : 200;

    const conditions = [];

    if (date) {
      conditions.push(eq(schema.aiProcessingLogs.date, date));
    }

    if (processType) {
      conditions.push(eq(schema.aiProcessingLogs.processType, processType));
    }

    if (status) {
      conditions.push(eq(schema.aiProcessingLogs.status, status));
    }

    let query = db
      .select()
      .from(schema.aiProcessingLogs)
      .orderBy(desc(schema.aiProcessingLogs.createdAt))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const logs = query.all();

    return c.json(logs);
  });

  /**
   * GET /api/ai-processing-logs/stats
   *
   * Query params:
   * - date: YYYY-MM-DD (optional)
   *
   * Returns statistics for AI processing logs
   */
  router.get("/stats", (c) => {
    const date = c.req.query("date");

    const conditions = [];
    if (date) {
      conditions.push(eq(schema.aiProcessingLogs.date, date));
    }

    let query = db.select().from(schema.aiProcessingLogs);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const allLogs = query.all();

    // Group by process type
    interface ProcessTypeStats {
      success: number;
      error: number;
      totalDuration: number;
      count: number;
    }
    const byProcessType = new Map<string, ProcessTypeStats>();
    for (const log of allLogs) {
      const pt = log.processType;
      const existing = byProcessType.get(pt) || {
        success: 0,
        error: 0,
        totalDuration: 0,
        count: 0,
      };
      if (log.status === "success") {
        existing.success++;
      } else {
        existing.error++;
      }
      existing.totalDuration += log.durationMs;
      existing.count++;
      byProcessType.set(pt, existing);
    }

    // Calculate averages
    const byProcessTypeResult: Record<
      string,
      { success: number; error: number; avgDuration: number }
    > = {};
    for (const [key, value] of byProcessType) {
      byProcessTypeResult[key] = {
        success: value.success,
        error: value.error,
        avgDuration: value.count > 0 ? Math.round(value.totalDuration / value.count) : 0,
      };
    }

    const totalSuccess = allLogs.filter((l) => l.status === "success").length;
    const totalError = allLogs.filter((l) => l.status === "error").length;
    const totalDuration = allLogs.reduce((sum, l) => sum + l.durationMs, 0);

    return c.json({
      total: allLogs.length,
      success: totalSuccess,
      error: totalError,
      avgDuration: allLogs.length > 0 ? Math.round(totalDuration / allLogs.length) : 0,
      byProcessType: byProcessTypeResult,
    });
  });

  /**
   * POST /api/ai-processing-logs
   *
   * Record an AI processing log (called from Worker)
   */
  router.post("/", async (c) => {
    const body = await c.req.json<CreateAiProcessingLogRequest>();

    const result = db
      .insert(schema.aiProcessingLogs)
      .values({
        date: body.date,
        processType: body.processType,
        status: body.status,
        model: body.model ?? null,
        inputSize: body.inputSize ?? null,
        outputSize: body.outputSize ?? null,
        durationMs: body.durationMs,
        errorMessage: body.errorMessage ?? null,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  return router;
}
