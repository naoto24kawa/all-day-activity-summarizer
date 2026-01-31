/**
 * Tasks Hook
 */

import type {
  CreateMergeTaskResponse,
  DetectDuplicatesResponse,
  Task,
  TaskStats,
  TaskStatus,
} from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, patchAdasApi, postAdasApi } from "@/lib/adas-api";

export function useTasks(date?: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (date) params.set("date", date);

        const data = await fetchAdasApi<Task[]>(`/api/tasks?${params}`);
        setTasks(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch tasks");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateTask = useCallback(
    async (
      id: number,
      updates: {
        status?: TaskStatus;
        priority?: "high" | "medium" | "low" | null;
        dueDate?: string | null;
        rejectReason?: string;
        title?: string;
        description?: string;
        projectId?: number | null;
      },
    ) => {
      await patchAdasApi(`/api/tasks/${id}`, updates);
      await fetchTasks(true);
    },
    [fetchTasks],
  );

  const deleteTask = useCallback(
    async (id: number) => {
      await deleteAdasApi(`/api/tasks/${id}`);
      await fetchTasks(true);
    },
    [fetchTasks],
  );

  // 抽出関数のファクトリー (重複コード削減)
  type ExtractResult = { extracted: number; tasks: Task[] };

  const createExtractFn = useCallback(
    <T extends object>(endpoint: string) =>
      async (options?: T): Promise<ExtractResult> => {
        const result = await postAdasApi<ExtractResult>(endpoint, options ?? {});
        await fetchTasks(true);
        return result;
      },
    [fetchTasks],
  );

  const extractTasks = useCallback(
    (options?: { date?: string; messageIds?: number[] }) =>
      createExtractFn<{ date?: string; messageIds?: number[] }>("/api/tasks/extract")(options),
    [createExtractFn],
  );

  const extractGitHubTasks = useCallback(
    (options?: { date?: string }) =>
      createExtractFn<{ date?: string }>("/api/tasks/extract-github")(options),
    [createExtractFn],
  );

  const extractGitHubCommentTasks = useCallback(
    (options?: { date?: string }) =>
      createExtractFn<{ date?: string }>("/api/tasks/extract-github-comments")(options),
    [createExtractFn],
  );

  const extractMemoTasks = useCallback(
    (options?: { date?: string }) =>
      createExtractFn<{ date?: string }>("/api/tasks/extract-memos")(options),
    [createExtractFn],
  );

  const updateBatchTasks = useCallback(
    async (
      ids: number[],
      updates: {
        status?: TaskStatus;
        projectId?: number | null;
        priority?: "high" | "medium" | "low" | null;
        reason?: string;
      },
    ) => {
      const result = await patchAdasApi<{ updated: number; tasks: Task[] }>("/api/tasks/batch", {
        ids,
        ...updates,
      });
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  const detectDuplicates = useCallback(
    async (options?: { date?: string; projectId?: number; minSimilarity?: number }) => {
      const result = await postAdasApi<DetectDuplicatesResponse>(
        "/api/tasks/detect-duplicates",
        options ?? {},
      );
      return result;
    },
    [],
  );

  const createMergeTask = useCallback(
    async (options: {
      sourceTaskIds: number[];
      title: string;
      description?: string;
      priority?: "high" | "medium" | "low";
      projectId?: number;
    }) => {
      const result = await postAdasApi<CreateMergeTaskResponse>("/api/tasks/merge", options);
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  return {
    tasks,
    error,
    loading,
    refetch: fetchTasks,
    updateTask,
    updateBatchTasks,
    deleteTask,
    extractTasks,
    extractGitHubTasks,
    extractGitHubCommentTasks,
    extractMemoTasks,
    detectDuplicates,
    createMergeTask,
  };
}

export function useTaskStats(date?: string) {
  const [stats, setStats] = useState<TaskStats>({
    total: 0,
    pending: 0,
    accepted: 0,
    in_progress: 0,
    paused: 0,
    rejected: 0,
    completed: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const data = await fetchAdasApi<TaskStats>(`/api/tasks/stats?${params}`);
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch task stats");
    }
  }, [date]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, error, refetch: fetchStats };
}
