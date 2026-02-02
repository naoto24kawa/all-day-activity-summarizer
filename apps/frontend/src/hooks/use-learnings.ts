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
      options,
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

  const updateLearning = useCallback(
    async (
      id: number,
      data: {
        content?: string;
        category?: string | null;
        tags?: string[] | null;
        projectId?: number | null;
      },
    ) => {
      try {
        await putAdasApi(`/api/learnings/${id}`, data);
        await fetchLearnings(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update learning");
        throw err;
      }
    },
    [fetchLearnings],
  );

  const createLearning = useCallback(
    async (data: {
      content: string;
      date?: string;
      category?: string;
      tags?: string[];
      projectId?: number;
    }) => {
      try {
        await postAdasApi<Learning>("/api/learnings", data);
        await fetchLearnings(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create learning");
        throw err;
      }
    },
    [fetchLearnings],
  );

  return {
    learnings,
    error,
    loading,
    refetch: fetchLearnings,
    reviewLearning,
    deleteLearning,
    updateLearning,
    createLearning,
  };
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

/** 非同期版の抽出結果 (ジョブキュー登録) */
interface AsyncExtractResult {
  success: boolean;
  jobId: number;
  message: string;
}

export interface LearningExplanation {
  explanation: string;
  keyPoints: string[];
  relatedTopics: string[];
  practicalExamples?: string[];
}

export function useLearningExplain() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explainLearning = useCallback(async (id: number): Promise<LearningExplanation | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await postAdasApi<LearningExplanation>(`/api/learnings/${id}/explain`, {});
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to explain learning");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, explainLearning };
}

export interface LearningExportItem {
  id: number;
  date: string;
  content: string;
  category: string | null;
  tags: string[];
  sourceType: string;
  sourceId: string;
  projectId: number | null;
  confidence: number | null;
  createdAt: string;
}

export interface LearningImportItem {
  content: string;
  date?: string;
  category?: string;
  tags?: string[];
  projectId?: number;
}

export interface LearningImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function useLearningsExportImport() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportLearnings = useCallback(
    async (options?: {
      date?: string;
      category?: string;
      sourceType?: string;
      projectId?: number;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (options?.date) params.set("date", options.date);
        if (options?.category) params.set("category", options.category);
        if (options?.sourceType) params.set("sourceType", options.sourceType);
        if (options?.projectId) params.set("projectId", options.projectId.toString());

        const data = await fetchAdasApi<LearningExportItem[]>(`/api/learnings/export?${params}`);
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to export");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const importLearnings = useCallback(async (items: LearningImportItem[]) => {
    setLoading(true);
    setError(null);
    try {
      const result = await postAdasApi<LearningImportResult>("/api/learnings/import", items);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, exportLearnings, importLearnings };
}

/**
 * 学び抽出フック
 *
 * 非同期版: ジョブをキューに登録して即座にレスポンスを返す
 * 実際の抽出結果は SSE 通知 (useJobNotifications) で受け取る
 */
export function useLearningsExtract() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractFromTranscriptions = useCallback(
    async (date?: string): Promise<AsyncExtractResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await postAdasApi<AsyncExtractResult>(
          "/api/learnings/extract/transcriptions",
          { date },
        );
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to extract");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const extractFromGitHubComments = useCallback(
    async (date?: string): Promise<AsyncExtractResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await postAdasApi<AsyncExtractResult>(
          "/api/learnings/extract/github-comments",
          { date },
        );
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to extract");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const extractFromSlackMessages = useCallback(
    async (date?: string): Promise<AsyncExtractResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await postAdasApi<AsyncExtractResult>(
          "/api/learnings/extract/slack-messages",
          { date },
        );
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to extract");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {
    loading,
    error,
    extractFromTranscriptions,
    extractFromGitHubComments,
    extractFromSlackMessages,
  };
}
