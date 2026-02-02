/**
 * SSE Hook
 *
 * 統一 SSE サーバーに接続し、リアルタイムイベントを受信
 */

import type {
  BadgesData,
  RateLimitStatus,
  SSEConnectedData,
  SSEJobCompletedData,
} from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { SSE_SERVER_URL } from "@/lib/adas-api";

export interface UseSSEOptions {
  /** バッジ更新イベントハンドラ */
  onBadgesUpdated?: (data: BadgesData) => void;
  /** ジョブ完了イベントハンドラ */
  onJobCompleted?: (data: SSEJobCompletedData) => void;
  /** レート制限更新イベントハンドラ */
  onRateLimitUpdated?: (data: RateLimitStatus) => void;
  /** 接続完了イベントハンドラ */
  onConnected?: (data: SSEConnectedData) => void;
  /** 自動再接続を有効化 (デフォルト: true) */
  autoReconnect?: boolean;
}

export interface UseSSEResult {
  /** SSE 接続状態 */
  isConnected: boolean;
  /** クライアント ID (接続後に設定) */
  clientId: string | null;
  /** 再接続試行回数 */
  retryCount: number;
  /** 手動で再接続 */
  reconnect: () => void;
}

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 5000;

export function useSSE(options: UseSSEOptions = {}): UseSSEResult {
  const {
    onBadgesUpdated,
    onJobCompleted,
    onRateLimitUpdated,
    onConnected,
    autoReconnect = true,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // コールバックを最新の値に保つ
  const callbacksRef = useRef({
    onBadgesUpdated,
    onJobCompleted,
    onRateLimitUpdated,
    onConnected,
  });

  useEffect(() => {
    callbacksRef.current = {
      onBadgesUpdated,
      onJobCompleted,
      onRateLimitUpdated,
      onConnected,
    };
  }, [onBadgesUpdated, onJobCompleted, onRateLimitUpdated, onConnected]);

  const connect = useCallback(() => {
    // 既存の接続をクリーンアップ
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    const sseUrl = `${SSE_SERVER_URL}/sse`;
    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setRetryCount(0);
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      setClientId(null);
      eventSource.close();
      eventSourceRef.current = null;

      // 自動再接続
      if (autoReconnect) {
        setRetryCount((prev) => {
          const newCount = prev + 1;
          if (newCount <= MAX_RETRIES) {
            const delay = BASE_RETRY_DELAY_MS * 2 ** prev;
            console.log(`SSE reconnecting in ${delay}ms (attempt ${newCount}/${MAX_RETRIES})`);
            retryTimeoutRef.current = setTimeout(connect, delay);
          } else {
            console.warn("SSE max retries reached, giving up");
          }
          return newCount;
        });
      }
    };

    // 接続完了イベント
    eventSource.addEventListener("connected", (event) => {
      try {
        const data = JSON.parse(event.data) as SSEConnectedData;
        setClientId(data.clientId);
        callbacksRef.current.onConnected?.(data);
      } catch (e) {
        console.error("Failed to parse connected event:", e);
      }
    });

    // バッジ更新イベント
    eventSource.addEventListener("badges_updated", (event) => {
      try {
        const data = JSON.parse(event.data) as BadgesData;
        callbacksRef.current.onBadgesUpdated?.(data);
      } catch (e) {
        console.error("Failed to parse badges_updated event:", e);
      }
    });

    // ジョブ完了イベント
    eventSource.addEventListener("job_completed", (event) => {
      try {
        const data = JSON.parse(event.data) as SSEJobCompletedData;
        callbacksRef.current.onJobCompleted?.(data);
      } catch (e) {
        console.error("Failed to parse job_completed event:", e);
      }
    });

    // レート制限更新イベント
    eventSource.addEventListener("rate_limit_updated", (event) => {
      try {
        const data = JSON.parse(event.data) as RateLimitStatus;
        callbacksRef.current.onRateLimitUpdated?.(data);
      } catch (e) {
        console.error("Failed to parse rate_limit_updated event:", e);
      }
    });

    // ハートビート (接続維持確認用、特に処理不要)
    eventSource.addEventListener("heartbeat", () => {
      // ハートビートを受信したことをログ (デバッグ用)
    });
  }, [autoReconnect]);

  // 初回接続
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    setRetryCount(0);
    connect();
  }, [connect]);

  return {
    isConnected,
    clientId,
    retryCount,
    reconnect,
  };
}
