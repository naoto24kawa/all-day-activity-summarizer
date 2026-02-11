/**
 * Tab Badges Hook
 * 各タブのバッジカウントを取得するフック
 * SSE でリアルタイム更新 + 初回フェッチ
 */

import type { BadgesData, TaskStats } from "@repo/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";
import { TAB_GROUPS, type TabGroupId } from "@/lib/tab-groups";
import type { LearningsStats } from "./use-learnings";
import { useSSE } from "./use-sse";

export interface TaskBadges {
  pending: number;
  acceptedHigh: number;
  acceptedMedium: number;
  acceptedLow: number;
}

export interface TabBadges {
  tasks: number; // pending タスク数 (後方互換性のため残す)
  taskBadges: TaskBadges; // タスクの詳細バッジ
  learnings: number; // 復習期限の学び数
  slack: number; // 未読 Slack メッセージ数
  github: number; // 未読 GitHub アイテム数
}

export type GroupBadges = Record<TabGroupId, number>;

interface SlackUnreadCount {
  total: number;
  mention: number;
  channel: number;
  dm: number;
  keyword: number;
}

interface GitHubUnreadCount {
  total: number;
  issue: number;
  pullRequest: number;
  reviewRequest: number;
}

export function useTabBadges(date?: string) {
  const [badges, setBadges] = useState<TabBadges>({
    tasks: 0,
    taskBadges: {
      pending: 0,
      acceptedHigh: 0,
      acceptedMedium: 0,
      acceptedLow: 0,
    },
    learnings: 0,
    slack: 0,
    github: 0,
  });

  // SSE でバッジ更新を受信
  const handleBadgesUpdated = useCallback((data: BadgesData) => {
    setBadges((prev) => ({
      tasks: data.tasks.pending,
      taskBadges: {
        pending: data.tasks.pending,
        acceptedHigh: data.tasks.acceptedByPriority.high,
        acceptedMedium: data.tasks.acceptedByPriority.medium,
        acceptedLow: data.tasks.acceptedByPriority.low,
      },
      learnings: data.learnings.dueForReview,
      slack: data.slack.unread,
      github: data.github.unread,
    }));
  }, []);

  useSSE({
    onBadgesUpdated: handleBadgesUpdated,
  });

  // 初回フェッチ (SSE 接続前のデータ取得)
  const fetchBadges = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const [taskStats, learningsStats, slackUnread, githubUnread] = await Promise.all([
        fetchAdasApi<TaskStats>(`/api/tasks/stats?${params}`),
        fetchAdasApi<LearningsStats>("/api/learnings/stats"),
        fetchAdasApi<SlackUnreadCount>(`/api/slack-messages/unread-count?${params}`).catch(
          () => ({ total: 0 }) as SlackUnreadCount,
        ),
        fetchAdasApi<GitHubUnreadCount>(`/api/github-items/unread-count?${params}`).catch(
          () => ({ total: 0 }) as GitHubUnreadCount,
        ),
      ]);

      setBadges({
        tasks: taskStats.pending,
        taskBadges: {
          pending: taskStats.pending,
          acceptedHigh: taskStats.acceptedByPriority.high,
          acceptedMedium: taskStats.acceptedByPriority.medium,
          acceptedLow: taskStats.acceptedByPriority.low,
        },
        learnings: learningsStats.dueForReview,
        slack: slackUnread.total,
        github: githubUnread.total,
      });
    } catch {
      // エラー時はバッジを表示しない
    }
  }, [date]);

  // 初回フェッチのみ (ポーリングは廃止、SSE に移行)
  useEffect(() => {
    fetchBadges();
  }, [fetchBadges]);

  // グループごとのバッジ集計
  const groupBadges = useMemo<GroupBadges>(() => {
    const result: GroupBadges = {
      overview: 0,
      feeds: 0,
      tools: 0,
      system: 0,
    };

    for (const group of TAB_GROUPS) {
      let total = 0;
      for (const tab of group.tabs) {
        if (tab.badgeKey) {
          total += badges[tab.badgeKey];
        }
      }
      result[group.id] = total;
    }

    return result;
  }, [badges]);

  return { badges, groupBadges, refetch: fetchBadges };
}
