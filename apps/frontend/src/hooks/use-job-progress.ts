/**
 * Job Progress Hook
 *
 * ボタン起点のAIジョブを追跡し、完了までローディング状態を維持する
 */

import type { AIJobCompletedEvent } from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ADAS_API_URL } from "@/lib/adas-api";

interface UseJobProgressOptions {
  /** ジョブ完了時のコールバック */
  onJobCompleted?: (jobId: number) => void;
  /** 全ジョブ完了時のコールバック */
  onAllCompleted?: () => void;
}

interface UseJobProgressReturn {
  /** ジョブを追跡開始 */
  trackJob: (jobId: number) => void;
  /** 複数ジョブを追跡開始 */
  trackJobs: (jobIds: number[]) => void;
  /** 追跡中のジョブがあるか */
  isProcessing: boolean;
  /** 追跡中のジョブID一覧 */
  processingJobIds: number[];
  /** SSE接続中 */
  isConnected: boolean;
  /** 追跡をリセット */
  reset: () => void;
}

export function useJobProgress(options: UseJobProgressOptions = {}): UseJobProgressReturn {
  const { onJobCompleted, onAllCompleted } = options;

  const [processingJobIds, setProcessingJobIds] = useState<number[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onJobCompletedRef = useRef(onJobCompleted);
  const onAllCompletedRef = useRef(onAllCompleted);

  // コールバックの参照を更新
  useEffect(() => {
    onJobCompletedRef.current = onJobCompleted;
    onAllCompletedRef.current = onAllCompleted;
  }, [onJobCompleted, onAllCompleted]);

  // ジョブを追跡開始
  const trackJob = useCallback((jobId: number) => {
    setProcessingJobIds((prev) => {
      if (prev.includes(jobId)) return prev;
      return [...prev, jobId];
    });
  }, []);

  // 複数ジョブを追跡開始
  const trackJobs = useCallback((jobIds: number[]) => {
    setProcessingJobIds((prev) => {
      const newIds = jobIds.filter((id) => !prev.includes(id));
      if (newIds.length === 0) return prev;
      return [...prev, ...newIds];
    });
  }, []);

  // 追跡をリセット
  const reset = useCallback(() => {
    setProcessingJobIds([]);
  }, []);

  // SSE接続 (追跡中のジョブがある場合のみ)
  useEffect(() => {
    if (processingJobIds.length === 0) {
      // 追跡するジョブがない場合は接続を閉じる
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    // 既に接続中なら何もしない
    if (eventSourceRef.current) return;

    const connect = () => {
      const url = `${ADAS_API_URL}/api/ai-jobs/sse`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.close();
        eventSourceRef.current = null;
        // 再接続
        setTimeout(connect, 3000);
      };

      eventSource.addEventListener("job_completed", (event) => {
        try {
          const data = JSON.parse(event.data) as AIJobCompletedEvent;
          const completedJobId = data.jobId;

          setProcessingJobIds((prev) => {
            if (!prev.includes(completedJobId)) return prev;

            // コールバック呼び出し
            onJobCompletedRef.current?.(completedJobId);

            const next = prev.filter((id) => id !== completedJobId);

            // 全ジョブ完了
            if (next.length === 0) {
              onAllCompletedRef.current?.();
            }

            return next;
          });
        } catch (error) {
          console.error("[job-progress] Failed to parse SSE event:", error);
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
  }, [processingJobIds.length]);

  return {
    trackJob,
    trackJobs,
    isProcessing: processingJobIds.length > 0,
    processingJobIds,
    isConnected,
    reset,
  };
}
