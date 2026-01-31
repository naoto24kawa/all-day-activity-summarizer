/**
 * AI Jobs Hook
 *
 * SSE接続とジョブ管理
 */

import type { AIJob, AIJobCompletedEvent, AIJobStats, AIJobType } from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";

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
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
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

  // 初回統計取得 (SSE無効時も取得)
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // SSE接続
  useEffect(() => {
    if (!enableSSE) return;

    const connect = () => {
      const url = `${ADAS_API_URL}/api/ai-jobs/sse`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        console.log("[ai-jobs] SSE connected");
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        console.warn("[ai-jobs] SSE error, reconnecting...");

        // 再接続
        eventSource.close();
        setTimeout(connect, 5000);
      };

      eventSource.addEventListener("job_completed", (event) => {
        try {
          const data = JSON.parse(event.data) as AIJobCompletedEvent;
          console.log("[ai-jobs] Job completed:", data);

          // 統計を更新
          refreshStats();

          // コールバックを呼び出し
          onJobCompletedRef.current?.(data);
        } catch (error) {
          console.error("[ai-jobs] Failed to parse SSE event:", error);
        }
      });

      eventSource.addEventListener("heartbeat", () => {
        // ハートビート受信
      });
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [enableSSE, refreshStats]);

  return {
    stats,
    jobs,
    isConnected,
    enqueueJob,
    refreshStats,
    refreshJobs,
  };
}
