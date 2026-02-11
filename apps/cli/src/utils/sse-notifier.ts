/**
 * SSE Notifier
 *
 * API サーバーから SSE サーバーへイベントを送信するユーティリティ
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type {
  AIJob,
  BadgesData,
  RateLimitStatus,
  SSEEmitRequest,
  SSEEmitResponse,
  SSEEventType,
} from "@repo/types";
import consola from "consola";
import { and, count, eq, isNull, lte, or } from "drizzle-orm";
import type { AdasConfig } from "../config.js";

export class SSENotifier {
  private config: AdasConfig;

  constructor(config: AdasConfig) {
    this.config = config;
  }

  /**
   * SSE サーバーにイベントを送信
   */
  async emit(event: SSEEventType, data: unknown): Promise<void> {
    const sseUrl = this.config.sseServer.url;
    const body: SSEEmitRequest = { event, data };

    try {
      const response = await fetch(`${sseUrl}/rpc/emit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        consola.warn(`SSE emit failed: ${response.status} ${response.statusText}`);
      } else {
        const result = (await response.json()) as SSEEmitResponse;
        consola.debug(`SSE emit '${event}': sent=${result.sent}, failed=${result.failed}`);
      }
    } catch (error) {
      // SSE サーバー未起動時は無視
      if (error instanceof Error && error.name !== "TimeoutError") {
        consola.debug(`SSE server not available: ${error.message}`);
      }
    }
  }

  /**
   * バッジデータを DB から取得して通知
   */
  async emitBadgesUpdated(db: AdasDatabase): Promise<void> {
    const badges = this.fetchBadgesData(db);
    await this.emit("badges_updated", badges);
  }

  /**
   * ジョブ完了を通知
   */
  async emitJobCompleted(job: AIJob): Promise<void> {
    await this.emit("job_completed", {
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      resultSummary: job.resultSummary,
    });
  }

  /**
   * レート制限状態を通知
   */
  async emitRateLimitUpdated(status: RateLimitStatus): Promise<void> {
    await this.emit("rate_limit_updated", status);
  }

  /**
   * DB からバッジデータを取得
   */
  private fetchBadgesData(db: AdasDatabase): BadgesData {
    // Tasks: pending 状態のカウント
    const tasksResult = db
      .select({ count: count() })
      .from(schema.tasks)
      .where(eq(schema.tasks.status, "pending"))
      .get();
    const tasksPending = tasksResult?.count ?? 0;

    // Tasks: accepted 状態の優先度別カウント
    const acceptedTasks = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, "accepted"))
      .all();
    const acceptedByPriority = { high: 0, medium: 0, low: 0 };
    for (const task of acceptedTasks) {
      const priority = task.priority as "high" | "medium" | "low" | null;
      if (priority && priority in acceptedByPriority) {
        acceptedByPriority[priority]++;
      }
    }

    // Learnings: 復習期限のカウント
    const now = new Date().toISOString();
    const learningsResult = db
      .select({ count: count() })
      .from(schema.learnings)
      .where(or(isNull(schema.learnings.nextReviewAt), lte(schema.learnings.nextReviewAt, now)))
      .get();
    const learningsDue = learningsResult?.count ?? 0;

    // Slack: 優先度付き未読メッセージのカウント (high + medium)
    const slackResult = db
      .select({ count: count() })
      .from(schema.slackMessages)
      .where(
        and(
          eq(schema.slackMessages.isRead, false),
          or(
            eq(schema.slackMessages.priority, "high"),
            eq(schema.slackMessages.priority, "medium"),
          ),
        ),
      )
      .get();
    const slackPriorityCount = slackResult?.count ?? 0;

    // GitHub: 未読アイテムのカウント
    const githubResult = db
      .select({ count: count() })
      .from(schema.githubItems)
      .where(and(eq(schema.githubItems.isRead, false)))
      .get();
    const githubUnread = githubResult?.count ?? 0;

    // Notion: 未読アイテムのカウント
    const notionResult = db
      .select({ count: count() })
      .from(schema.notionItems)
      .where(eq(schema.notionItems.isRead, false))
      .get();
    const notionUnread = notionResult?.count ?? 0;

    return {
      tasks: { pending: tasksPending, acceptedByPriority },
      learnings: { dueForReview: learningsDue },
      slack: { priorityCount: slackPriorityCount },
      github: { unread: githubUnread },
      notion: { unread: notionUnread },
    };
  }
}

// シングルトンインスタンス (serve コマンドで初期化)
let sseNotifierInstance: SSENotifier | null = null;

/**
 * SSE Notifier インスタンスを取得
 */
export function getSSENotifier(): SSENotifier | null {
  return sseNotifierInstance;
}

/**
 * SSE Notifier インスタンスを初期化
 */
export function initSSENotifier(config: AdasConfig): SSENotifier {
  sseNotifierInstance = new SSENotifier(config);
  return sseNotifierInstance;
}
