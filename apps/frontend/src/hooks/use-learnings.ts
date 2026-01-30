/**
 * Learnings Hook
 */

import type { Learning, LearningSourceType } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, postAdasApi, putAdasApi } from "@/lib/adas-api";

export interface LearningsStats {
  total: number;
  dueForReview: number;
  byCategory: Record<string, number>;
  byDate: Record<string, number>;
  bySourceType: Record<string, number>;
}

interface LearningsOptions {
  date?: string;
  category?: string;
  sourceType?: LearningSourceType;
  sourceId?: string;
  dueForReview?: boolean;
}

function buildLearningsParams(options?: LearningsOptions): URLSearchParams {
  const params = new URLSearchParams();
  if (options?.date) params.set("date", options.date);
  if (options?.category) params.set("category", options.category);
  if (options?.sourceType) params.set("sourceType", options.sourceType);
  if (options?.sourceId) params.set("sourceId", options.sourceId);
  if (options?.dueForReview) params.set("dueForReview", "true");
  return params;
}

export function useLearnings(options?: LearningsOptions) {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLearnings = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = buildLearningsParams(options);
        const data = await fetchAdasApi<Learning[]>(`/api/learnings?${params}`);
        setLearnings(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch learnings");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [
      options?.date,
      options?.category,
      options?.sourceType,
      options?.sourceId,
      options?.dueForReview,
    ],
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
    bySourceType: {},
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

interface ExtractResult {
  extracted: number;
  saved: number;
  message?: string;
}

export function useLearningsExtract() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractFromTranscriptions = useCallback(async (date?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await postAdasApi<ExtractResult>("/api/learnings/extract/transcriptions", {
        date,
      });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const extractFromGitHubComments = useCallback(async (date?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await postAdasApi<ExtractResult>("/api/learnings/extract/github-comments", {
        date,
      });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const extractFromSlackMessages = useCallback(async (date?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await postAdasApi<ExtractResult>("/api/learnings/extract/slack-messages", {
        date,
      });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    extractFromTranscriptions,
    extractFromGitHubComments,
    extractFromSlackMessages,
  };
}
