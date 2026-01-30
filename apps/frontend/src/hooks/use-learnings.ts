/**
 * Learnings Hook
 */

import type { Learning } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, putAdasApi } from "@/lib/adas-api";

export interface LearningsStats {
  total: number;
  dueForReview: number;
  byCategory: Record<string, number>;
  byDate: Record<string, number>;
}

export function useLearnings(options?: {
  date?: string;
  category?: string;
  sessionId?: string;
  dueForReview?: boolean;
}) {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLearnings = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (options?.date) params.set("date", options.date);
        if (options?.category) params.set("category", options.category);
        if (options?.sessionId) params.set("sessionId", options.sessionId);
        if (options?.dueForReview) params.set("dueForReview", "true");

        const data = await fetchAdasApi<Learning[]>(`/api/learnings?${params}`);
        setLearnings(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch learnings");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [options?.date, options?.category, options?.sessionId, options?.dueForReview],
  );

  useEffect(() => {
    fetchLearnings();
  }, [fetchLearnings]);

  const reviewLearning = useCallback(
    async (id: number, quality: number) => {
      try {
        await putAdasApi(`/api/learnings/${id}/review`, { quality });
        await fetchLearnings(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to review learning");
      }
    },
    [fetchLearnings],
  );

  const deleteLearning = useCallback(
    async (id: number) => {
      try {
        await deleteAdasApi(`/api/learnings/${id}`);
        await fetchLearnings(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete learning");
      }
    },
    [fetchLearnings],
  );

  return { learnings, error, loading, refetch: fetchLearnings, reviewLearning, deleteLearning };
}

export function useLearningsStats() {
  const [stats, setStats] = useState<LearningsStats>({
    total: 0,
    dueForReview: 0,
    byCategory: {},
    byDate: {},
  });
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await fetchAdasApi<LearningsStats>("/api/learnings/stats");
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, error, refetch: fetchStats };
}
