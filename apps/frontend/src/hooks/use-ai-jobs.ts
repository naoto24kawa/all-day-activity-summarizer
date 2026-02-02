/**
 * AI Jobs Hook
 *
 * 統一 SSE サーバー経由でジョブ完了を受信
 */

import type {
  AIJob,
  AIJobCompletedEvent,
  AIJobStats,
  AIJobType,
  SSEJobCompletedData,
} from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";
import { useSSE } from "./use-sse";

interface UseAIJobsOptions {
  /** SSE接続を有効化 */
  enableSSE?: boolean;
  /** ジョブ完了時のコールバック */
  onJobCompleted?: (event: AIJobCompletedEvent) => void;
}

interface UseAIJobsReturn {
  /** ジョブ統計 */
  stats: AIJobStats | null;
  /** ジョブ一覧 */
  jobs: AIJob[];
  /** SSE接続中 */
  isConnected: boolean;
  /** ジョブを登録 */
  enqueueJob: (
    jobType: AIJobType,
    params?: Record<string, unknown>,
  ) => Promise<{ jobId: number; status: string }>;
  /** 統計を更新 */
  refreshStats: () => Promise<void>;
  /** ジョブ一覧を更新 */
  refreshJobs: () => Promise<void>;
}

export function useAIJobs(options: UseAIJobsOptions = {}): UseAIJobsReturn {
  const { enableSSE = true, onJobCompleted } = options;

  const [stats, setStats] = useState<AIJobStats | null>(null);
  const [jobs, setJobs] = useState<AIJob[]>([]);
  const onJobCompletedRef = useRef(onJobCompleted);

  // コールバックの参照を更新
  useEffect(() => {
    onJobCompletedRef.current = onJobCompleted;
  }, [onJobCompleted]);

  // 統計を取得
  const refreshStats = useCallback(async () => {
    try {
      const data = await fetchAdasApi<AIJobStats>("/api/ai-jobs/stats");
      setStats(data);
    } catch (error) {
      console.error("[ai-jobs] Failed to fetch stats:", error);
    }
  }, []);

  // ジョブ一覧を取得
  const refreshJobs = useCallback(async () => {
    try {
      const data = await fetchAdasApi<AIJob[]>("/api/ai-jobs?limit=20");
      setJobs(data);
    } catch (error) {
      console.error("[ai-jobs] Failed to fetch jobs:", error);
    }
  }, []);

  // ジョブを登録
  const enqueueJob = useCallback(
    async (
      jobType: AIJobType,
      params?: Record<string, unknown>,
    ): Promise<{ jobId: number; status: string }> => {
      const data = await postAdasApi<{ jobId: number; status: string }>("/api/ai-jobs", {
        jobType,
        params,
      });

      // 統計を更新
      refreshStats();

      return data;
    },
    [refreshStats],
  );

  // SSE でジョブ完了を受信
  const handleJobCompleted = useCallback(
    (data: SSEJobCompletedData) => {
      console.log("[ai-jobs] Job completed:", data);

      // 統計を更新
      refreshStats();

      // コールバックを呼び出し
      onJobCompletedRef.current?.(data);
    },
    [refreshStats],
  );

  // 統一 SSE フックを使用
  const { isConnected } = useSSE(
    enableSSE
      ? {
          onJobCompleted: handleJobCompleted,
        }
      : {},
  );

  // 初回統計取得のみ (ポーリングは廃止)
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  return {
    stats,
    jobs,
    isConnected,
    enqueueJob,
    refreshStats,
    refreshJobs,
  };
}
