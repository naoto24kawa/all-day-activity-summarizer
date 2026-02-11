/**
 * Slack Priority Handler
 *
 * Slack メッセージの優先度を AI で判定し、DB を更新
 * 高優先度の場合は通知を送信
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type {
  RpcSlackPriorityRequest,
  RpcSlackPriorityResponse,
  SlackPriorityUserProfile,
} from "@repo/types";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { getUserProfile } from "../../server/routes/profile.js";
import { getSSENotifier } from "../../utils/sse-notifier.js";
import type { JobResult } from "../worker.js";

interface SlackPriorityParams {
  messageId: number;
}

// 同一スレッドの通知抑制用キャッシュ (threadTs -> 最終通知時刻)
const notificationCooldownCache = new Map<string, number>();
const DEFAULT_COOLDOWN_MINUTES = 5;

/**
 * クールダウン中かチェック
 */
function isInCooldown(threadTs: string | null, cooldownMinutes: number): boolean {
  if (!threadTs) return false;

  const lastNotified = notificationCooldownCache.get(threadTs);
  if (!lastNotified) return false;

  const cooldownMs = cooldownMinutes * 60 * 1000;
  return Date.now() - lastNotified < cooldownMs;
}

/**
 * クールダウンキャッシュを更新
 */
function updateCooldown(threadTs: string | null): void {
  if (threadTs) {
    notificationCooldownCache.set(threadTs, Date.now());
  }
}

/**
 * Slack メッセージの優先度を判定
 */
export async function handleSlackPriority(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const { messageId } = params as unknown as SlackPriorityParams;

  // メッセージを取得
  const message = db
    .select()
    .from(schema.slackMessages)
    .where(eq(schema.slackMessages.id, messageId))
    .get();

  if (!message) {
    return {
      success: false,
      resultSummary: `メッセージが見つかりません: ${messageId}`,
    };
  }

  // 既に優先度が設定されている場合はスキップ
  if (message.priority) {
    return {
      success: true,
      resultSummary: `既に優先度が設定されています: ${message.priority}`,
      data: { priority: message.priority },
    };
  }

  // mention/dm は自動的に high に設定
  if (message.messageType === "mention" || message.messageType === "dm") {
    const priority = "high";
    db.update(schema.slackMessages)
      .set({ priority })
      .where(eq(schema.slackMessages.id, messageId))
      .run();

    // 高優先度通知
    await notifyHighPriority(db, config, message, {
      priority,
      reason: `${message.messageType === "mention" ? "メンション" : "DM"}のため高優先度に設定`,
    });

    return {
      success: true,
      resultSummary: `${message.messageType} のため高優先度に設定`,
      data: { priority },
    };
  }

  // keyword メッセージは設定の優先度を自動適用 (AI 判定をスキップ)
  if (message.messageType === "keyword") {
    const priority = config.slack.keywordPriority ?? "medium";
    db.update(schema.slackMessages)
      .set({ priority })
      .where(eq(schema.slackMessages.id, messageId))
      .run();

    // 高優先度の場合は通知
    if (priority === "high") {
      await notifyHighPriority(db, config, message, {
        priority,
        reason: "キーワードマッチのため設定優先度を適用",
      });
    }

    return {
      success: true,
      resultSummary: `keyword のため設定優先度を適用: ${priority}`,
      data: { priority },
    };
  }

  // テキストが空の場合はデフォルト優先度を設定
  if (!message.text || message.text.trim() === "") {
    const defaultPriority = "low";
    db.update(schema.slackMessages)
      .set({ priority: defaultPriority })
      .where(eq(schema.slackMessages.id, messageId))
      .run();

    return {
      success: true,
      resultSummary: `テキストが空のためデフォルト優先度を設定: ${defaultPriority}`,
      data: { priority: defaultPriority },
    };
  }

  // ユーザープロフィールを取得
  const profile = getUserProfile(db);
  const userProfile: SlackPriorityUserProfile | undefined = profile
    ? {
        displayName: profile.displayName,
        slackUserId: profile.slackUserId,
        githubUsername: profile.githubUsername,
        responsibilities: profile.responsibilities,
        specialties: profile.specialties,
      }
    : undefined;

  // Worker に優先度判定をリクエスト
  const workerUrl = config.worker.url;
  const request: RpcSlackPriorityRequest = {
    messageId,
    text: message.text,
    userName: message.userName,
    channelName: message.channelName,
    messageType: message.messageType as "mention" | "channel" | "dm" | "keyword",
    userProfile,
  };

  try {
    const response = await fetch(`${workerUrl}/rpc/slack-priority`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(config.worker.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Worker request failed: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as RpcSlackPriorityResponse;

    // DB を更新
    db.update(schema.slackMessages)
      .set({ priority: result.priority })
      .where(eq(schema.slackMessages.id, messageId))
      .run();

    // 高優先度の場合は通知
    if (result.priority === "high") {
      await notifyHighPriority(db, config, message, result);
    }

    return {
      success: true,
      resultSummary: `優先度を設定しました: ${result.priority} (${result.reason})`,
      data: {
        messageId,
        priority: result.priority,
        reason: result.reason,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    consola.error(`[slack-priority] Failed to determine priority for message ${messageId}:`, error);

    return {
      success: false,
      resultSummary: `優先度判定に失敗しました: ${errorMessage}`,
    };
  }
}

/**
 * 高優先度メッセージの通知
 */
async function notifyHighPriority(
  _db: AdasDatabase,
  config: AdasConfig,
  message: typeof schema.slackMessages.$inferSelect,
  result: RpcSlackPriorityResponse,
): Promise<void> {
  const cooldownMinutes =
    config.slack.priorityNotification?.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;

  // 同一スレッドのクールダウンチェック
  if (isInCooldown(message.threadTs, cooldownMinutes)) {
    consola.debug(
      `[slack-priority] Skipping notification for message ${message.id} (cooldown for thread ${message.threadTs})`,
    );
    return;
  }

  // 通知設定を確認
  const notificationConfig = config.slack.priorityNotification;
  if (!notificationConfig?.enabled) {
    return;
  }

  // ターミナル通知
  if (notificationConfig.terminalNotify) {
    const channelInfo = message.channelName ? `#${message.channelName}` : message.channelId;
    const userInfo = message.userName ?? "Unknown";
    const textPreview =
      message.text.length > 100 ? `${message.text.slice(0, 100)}...` : message.text;

    consola.box({
      title: `🔴 高優先度メッセージ`,
      message: `${channelInfo} - ${userInfo}\n${textPreview}\n\n理由: ${result.reason}`,
      style: {
        borderColor: "red",
      },
    });
  }

  // SSE 通知
  if (notificationConfig.sseNotify) {
    const sseNotifier = getSSENotifier();
    if (sseNotifier) {
      await sseNotifier.emit("slack_high_priority", {
        messageId: message.id,
        channelName: message.channelName,
        userName: message.userName,
        text: message.text,
        permalink: message.permalink,
        reason: result.reason,
      });
    }
  }

  // クールダウンを更新
  updateCooldown(message.threadTs);
}
