/**
 * Project Activities Hook
 *
 * プロジェクトに紐づく各種アクティビティを取得するフック
 */

import type { ClaudeCodeSession, Learning, NotionItem, SlackMessage, Task } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi } from "@/lib/adas-api";

export interface ProjectActivity {
  type: "slack" | "github" | "notion" | "claude" | "task" | "learning";
  id: number | string;
  title: string;
  description?: string;
  date: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

interface UseProjectActivitiesOptions {
  projectId: number | null;
  limit?: number;
}

interface UseProjectActivitiesReturn {
  activities: ProjectActivity[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  // 各データタイプの件数
  counts: {
    slack: number;
    github: number;
    notion: number;
    claude: number;
    task: number;
    learning: number;
  };
}

export function useProjectActivities({
  projectId,
  limit = 50,
}: UseProjectActivitiesOptions): UseProjectActivitiesReturn {
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    slack: 0,
    github: 0,
    notion: 0,
    claude: 0,
    task: 0,
    learning: 0,
  });

  const fetchActivities = useCallback(async () => {
    if (!projectId) {
      setActivities([]);
      setCounts({ slack: 0, github: 0, notion: 0, claude: 0, task: 0, learning: 0 });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const allActivities: ProjectActivity[] = [];
      const newCounts = { slack: 0, github: 0, notion: 0, claude: 0, task: 0, learning: 0 };

      // 並列でデータを取得
      const [slackRes, claudeRes, notionRes, learningsRes, tasksRes] = await Promise.allSettled([
        fetchAdasApi<{ data: SlackMessage[]; totalCount: number }>(
          `/api/slack-messages?projectId=${projectId}&limit=${limit}`,
        ),
        fetchAdasApi<{ data: ClaudeCodeSession[]; totalCount: number }>(
          `/api/claude-code-sessions?projectId=${projectId}&limit=${limit}`,
        ),
        fetchAdasApi<{ data: NotionItem[]; totalCount: number }>(
          `/api/notion-items?projectId=${projectId}&limit=${limit}`,
        ),
        fetchAdasApi<Learning[]>(`/api/learnings?projectId=${projectId}&limit=${limit}`),
        fetchAdasApi<Task[]>(`/api/tasks?projectId=${projectId}&limit=${limit}`),
      ]);

      // Slack メッセージ
      if (slackRes.status === "fulfilled" && slackRes.value?.data) {
        const messages = slackRes.value.data;
        newCounts.slack = messages.length;
        for (const msg of messages) {
          allActivities.push({
            type: "slack",
            id: msg.id,
            title: msg.channelName || msg.channelId,
            description: msg.text.slice(0, 200),
            date: msg.date,
            url: msg.permalink || undefined,
            metadata: { userName: msg.userName, messageType: msg.messageType },
          });
        }
      }

      // Claude Code セッション
      if (claudeRes.status === "fulfilled" && claudeRes.value?.data) {
        const sessions = claudeRes.value.data;
        newCounts.claude = sessions.length;
        for (const session of sessions) {
          allActivities.push({
            type: "claude",
            id: session.id,
            title: session.projectName || session.projectPath || "Unknown",
            description: session.summary?.slice(0, 200),
            date: session.date,
            metadata: { userMessageCount: session.userMessageCount },
          });
        }
      }

      // Notion Items
      if (notionRes.status === "fulfilled" && notionRes.value?.data) {
        const items = notionRes.value.data;
        newCounts.notion = items.length;
        for (const item of items) {
          allActivities.push({
            type: "notion",
            id: item.id,
            title: item.title,
            date: item.date,
            url: item.url,
            metadata: { parentType: item.parentType, lastEditedBy: item.lastEditedBy },
          });
        }
      }

      // Learnings
      if (learningsRes.status === "fulfilled" && Array.isArray(learningsRes.value)) {
        const learnings = learningsRes.value;
        newCounts.learning = learnings.length;
        for (const learning of learnings) {
          // Learning には title がないので content の先頭部分を使用
          const contentPreview = learning.content.slice(0, 50);
          const title = contentPreview.includes("\n")
            ? contentPreview.split("\n")[0] || contentPreview
            : contentPreview;
          allActivities.push({
            type: "learning",
            id: learning.id,
            title: title + (title.length < learning.content.length ? "..." : ""),
            description: learning.content.slice(0, 200),
            date: learning.date,
            metadata: { category: learning.category, sourceType: learning.sourceType },
          });
        }
      }

      // Tasks
      if (tasksRes.status === "fulfilled" && Array.isArray(tasksRes.value)) {
        const tasks = tasksRes.value;
        newCounts.task = tasks.length;
        for (const task of tasks) {
          allActivities.push({
            type: "task",
            id: task.id,
            title: task.title,
            description: task.description?.slice(0, 200),
            date: task.date,
            metadata: { status: task.status, priority: task.priority },
          });
        }
      }

      // 日付でソート (新しい順)
      allActivities.sort((a, b) => b.date.localeCompare(a.date));

      setActivities(allActivities.slice(0, limit));
      setCounts(newCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch activities");
    } finally {
      setLoading(false);
    }
  }, [projectId, limit]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  return {
    activities,
    loading,
    error,
    refetch: fetchActivities,
    counts,
  };
}
