/**
 * Tasks Hook
 */

import type { Task, TaskStats, TaskStatus } from "@repo/types";
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
        priority?: string;
        dueDate?: string | null;
        rejectReason?: string;
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

  const extractTasks = useCallback(
    async (options?: { date?: string; messageIds?: number[] }) => {
      const result = await postAdasApi<{ extracted: number; tasks: Task[] }>(
        "/api/tasks/extract",
        options ?? {},
      );
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
    deleteTask,
    extractTasks,
  };
}

export function useTaskStats(date?: string) {
  const [stats, setStats] = useState<TaskStats>({
    total: 0,
    pending: 0,
    accepted: 0,
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
