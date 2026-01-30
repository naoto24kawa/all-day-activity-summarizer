/**
 * Tab Badges Hook
 * 各タブのバッジカウントを取得するフック
 */

import type { TaskStats } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";
import type { LearningsStats } from "./use-learnings";

export interface TabBadges {
  tasks: number; // pending タスク数
  learnings: number; // 復習期限の学び数
}

export function useTabBadges(date?: string) {
  const [badges, setBadges] = useState<TabBadges>({
    tasks: 0,
    learnings: 0,
  });

  const fetchBadges = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const [taskStats, learningsStats] = await Promise.all([
        fetchAdasApi<TaskStats>(`/api/tasks/stats?${params}`),
        fetchAdasApi<LearningsStats>("/api/learnings/stats"),
      ]);

      setBadges({
        tasks: taskStats.pending,
        learnings: learningsStats.dueForReview,
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

  return { badges, refetch: fetchBadges };
}
