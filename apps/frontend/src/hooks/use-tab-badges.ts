/**
 * Tab Badges Hook
 * 各タブのバッジカウントを取得するフック
 */

import type { TaskStats } from "@repo/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";
import { TAB_GROUPS, type TabGroupId } from "@/lib/tab-groups";
import type { LearningsStats } from "./use-learnings";

export interface TabBadges {
  tasks: number; // pending タスク数
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
    learnings: 0,
    slack: 0,
    github: 0,
  });

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
        learnings: learningsStats.dueForReview,
        slack: slackUnread.total,
        github: githubUnread.total,
      });
    } catch {
      // エラー時はバッジを表示しない
    }
  }, [date]);

  useEffect(() => {
    fetchBadges();
    const interval = setInterval(fetchBadges, 30_000);
    return () => clearInterval(interval);
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
