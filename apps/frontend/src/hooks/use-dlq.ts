/**
 * DLQ (Dead Letter Queue) Hook
 *
 * DLQ ジョブの一覧取得、統計、再実行、無視操作
 */

import type { DLQJob, DLQOriginalQueue, DLQRetryResponse, DLQStats, DLQStatus } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export interface UseDLQOptions {
  status?: DLQStatus;
  queue?: DLQOriginalQueue;
  limit?: number;
}

export function useDLQ(options?: UseDLQOptions) {
  const [jobs, setJobs] = useState<DLQJob[]>([]);
  const [stats, setStats] = useState<DLQStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (options?.status) params.set("status", options.status);
      if (options?.queue) params.set("queue", options.queue);
      if (options?.limit) params.set("limit", String(options.limit));

      const query = params.toString();
      const path = query ? `/api/dlq?${query}` : "/api/dlq";

      const data = await fetchAdasApi<DLQJob[]>(path);
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch DLQ jobs");
    } finally {
      setIsLoading(false);
    }
  }, [options?.status, options?.queue, options?.limit]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await fetchAdasApi<DLQStats>("/api/dlq/stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch DLQ stats:", err);
    }
  }, []);

  const retryJob = useCallback(
    async (dlqId: number): Promise<DLQRetryResponse> => {
      const response = await postAdasApi<DLQRetryResponse>(`/api/dlq/${dlqId}/retry`, {});
      if (response.success) {
        await fetchJobs();
        await fetchStats();
      }
      return response;
    },
    [fetchJobs, fetchStats],
  );

  const ignoreJob = useCallback(
    async (dlqId: number): Promise<boolean> => {
      const response = await postAdasApi<{ success: boolean }>(`/api/dlq/${dlqId}/ignore`, {});
      if (response.success) {
        await fetchJobs();
        await fetchStats();
      }
      return response.success;
    },
    [fetchJobs, fetchStats],
  );

  useEffect(() => {
    fetchJobs();
    fetchStats();
  }, [fetchJobs, fetchStats]);

  return {
    jobs,
    stats,
    isLoading,
    error,
    refetch: fetchJobs,
    refetchStats: fetchStats,
    retryJob,
    ignoreJob,
  };
}
