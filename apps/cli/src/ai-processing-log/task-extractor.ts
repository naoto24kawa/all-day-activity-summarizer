/**
 * AI Processing Log Task Extractor
 *
 * aiProcessingLogs テーブルの status="error" レコードから
 * キーワードマッチングでタスクを自動生成
 */

import type { AdasDatabase, AiProcessingLog, NewTask } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { and, eq, inArray } from "drizzle-orm";
import { getTodayDateString } from "../utils/date.js";
import { hasExtractionLog, recordExtractionLog } from "../utils/extraction-log.js";
import {
  type ErrorKeywordMapping,
  findMatchingMapping,
  formatTitle,
} from "./error-keyword-mappings.js";

export interface ExtractAiProcessingLogsParams {
  date?: string;
  processTypes?: string[];
  limit?: number;
}

export interface ExtractAiProcessingLogsResult {
  extracted: number;
  processed: number;
  skipped: number;
  unmatched: number;
  grouped: number;
  tasks: (typeof schema.tasks.$inferSelect)[];
}

interface GroupedError {
  processType: string;
  mapping: ErrorKeywordMapping;
  logs: AiProcessingLog[];
  sourceIds: string[];
}

/**
 * aiProcessingLogs のソース ID を生成
 */
function generateSourceId(logId: number): string {
  return `ai-log-${logId}`;
}

/**
 * AI Processing Logs からタスクを抽出
 */
export function extractTasksFromAiProcessingLogs(
  db: AdasDatabase,
  params: ExtractAiProcessingLogsParams,
): ExtractAiProcessingLogsResult {
  const date = params.date ?? getTodayDateString();
  const limit = Math.min(params.limit ?? 50, 100);

  // status="error" のログを取得
  const conditions = [
    eq(schema.aiProcessingLogs.status, "error"),
    eq(schema.aiProcessingLogs.date, date),
  ];

  if (params.processTypes && params.processTypes.length > 0) {
    conditions.push(
      inArray(
        schema.aiProcessingLogs.processType,
        params.processTypes as (typeof schema.aiProcessingLogs.processType.enumValues)[number][],
      ),
    );
  }

  const errorLogs = db
    .select()
    .from(schema.aiProcessingLogs)
    .where(and(...conditions))
    .limit(1000) // 一旦多めに取得
    .all();

  if (errorLogs.length === 0) {
    return {
      extracted: 0,
      processed: 0,
      skipped: 0,
      unmatched: 0,
      grouped: 0,
      tasks: [],
    };
  }

  // 処理済みを除外
  const unprocessedLogs = errorLogs.filter((log) => {
    const sourceId = generateSourceId(log.id);
    return !hasExtractionLog(db, "task", "ai-processing-log", sourceId);
  });

  const skipped = errorLogs.length - unprocessedLogs.length;

  if (unprocessedLogs.length === 0) {
    return {
      extracted: 0,
      processed: 0,
      skipped,
      unmatched: 0,
      grouped: 0,
      tasks: [],
    };
  }

  // 上限適用
  const targetLogs = unprocessedLogs.slice(0, limit);

  // 同じ processType + キーワードマッチでグループ化
  const groups = new Map<string, GroupedError>();
  const unmatchedLogs: AiProcessingLog[] = [];

  for (const log of targetLogs) {
    const errorMessage = log.errorMessage ?? "";
    const mapping = findMatchingMapping(errorMessage);

    if (!mapping) {
      unmatchedLogs.push(log);
      continue;
    }

    // グループキー: processType + マッピングのタイトルテンプレート
    const groupKey = `${log.processType}:${mapping.titleTemplate}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        processType: log.processType,
        mapping,
        logs: [],
        sourceIds: [],
      });
    }

    const group = groups.get(groupKey)!;
    group.logs.push(log);
    group.sourceIds.push(generateSourceId(log.id));
  }

  // グループごとにタスクを生成
  const createdTasks: (typeof schema.tasks.$inferSelect)[] = [];

  for (const group of groups.values()) {
    const title = formatTitle(group.mapping.titleTemplate, group.processType);
    const errorCount = group.logs.length;

    // 説明文を構築
    let description = group.mapping.descriptionTemplate ?? "";
    if (errorCount > 1) {
      description += `\n\n同様のエラーが ${errorCount} 件発生しています。`;
    }

    // 最初のエラーメッセージをサンプルとして追加
    const sampleError = group.logs[0]?.errorMessage;
    if (sampleError) {
      const truncated = sampleError.length > 200 ? `${sampleError.slice(0, 200)}...` : sampleError;
      description += `\n\n例: ${truncated}`;
    }

    const taskData: NewTask = {
      date,
      sourceType: "ai-processing-log",
      title,
      description: description.trim() || null,
      priority: group.mapping.priority,
      workType: group.mapping.workType,
      confidence: 0.9, // キーワードマッチなので高い確信度
    };

    const task = db.insert(schema.tasks).values(taskData).returning().get();
    createdTasks.push(task);

    // 処理済みとして記録
    for (const sourceId of group.sourceIds) {
      recordExtractionLog(db, "task", "ai-processing-log", sourceId, 1);
    }

    consola.debug(`[ai-processing-log] Created task: "${title}" (${errorCount} logs)`);
  }

  // マッチしなかったログも処理済みとして記録 (再処理防止)
  for (const log of unmatchedLogs) {
    const sourceId = generateSourceId(log.id);
    recordExtractionLog(db, "task", "ai-processing-log", sourceId, 0);
  }

  consola.info(
    `[ai-processing-log] Extracted ${createdTasks.length} tasks from ${targetLogs.length} error logs (${groups.size} groups, ${unmatchedLogs.length} unmatched)`,
  );

  return {
    extracted: createdTasks.length,
    processed: targetLogs.length,
    skipped,
    unmatched: unmatchedLogs.length,
    grouped: groups.size,
    tasks: createdTasks,
  };
}
