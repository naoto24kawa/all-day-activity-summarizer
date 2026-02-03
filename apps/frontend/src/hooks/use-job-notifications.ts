/**
 * Job Notifications Hook
 *
 * AI ジョブ完了時の通知 (トースト + Web通知 + 音)
 */

import type { AIJob, AIJobCompletedEvent, AIJobStats, AIJobType } from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAIJobs } from "./use-ai-jobs";

/** ジョブタイプの表示名 */
const JOB_TYPE_LABELS: Record<AIJobType, string> = {
  "task-extract-slack": "Slackタスク抽出",
  "task-extract-github": "GitHubタスク抽出",
  "task-extract-github-comment": "GitHubコメントタスク抽出",
  "task-extract-memo": "メモタスク抽出",
  "task-elaborate": "タスク詳細化",
  "task-check-completion": "タスク完了チェック",
  "task-check-completion-individual": "タスク完了チェック",
  "learning-extract": "学び抽出",
  "vocabulary-extract": "用語抽出",
  "vocabulary-generate-readings": "読み仮名生成",
  "profile-analyze": "プロフィール分析",
  "summarize-times": "時間範囲サマリ",
  "summarize-daily": "日次サマリ",
  "slack-priority": "Slack優先度判定",
  "claude-chat": "Claude送信",
};

interface UseJobNotificationsOptions {
  /** トースト通知を有効化 */
  enableToast?: boolean;
  /** Web通知を有効化 */
  enableWebNotification?: boolean;
  /** 通知音を有効化 */
  enableSound?: boolean;
  /** タスク更新コールバック */
  onTasksUpdated?: () => void;
  /** 学び更新コールバック */
  onLearningsUpdated?: () => void;
}

interface UseJobNotificationsReturn {
  /** ジョブ統計 */
  stats: AIJobStats | null;
  /** ジョブ一覧 */
  jobs: AIJob[];
  /** SSE接続中 */
  isConnected: boolean;
  /** Web通知の許可状態 */
  notificationPermission: NotificationPermission | null;
  /** Web通知の許可をリクエスト */
  requestNotificationPermission: () => Promise<void>;
  /** ジョブ一覧を更新 */
  refreshJobs: () => Promise<void>;
}

export function useJobNotifications(
  options: UseJobNotificationsOptions = {},
): UseJobNotificationsReturn {
  const {
    enableToast = true,
    enableWebNotification = true,
    enableSound = true,
    onTasksUpdated,
    onLearningsUpdated,
  } = options;

  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTasksUpdatedRef = useRef(onTasksUpdated);
  const onLearningsUpdatedRef = useRef(onLearningsUpdated);

  // コールバックの参照を更新
  useEffect(() => {
    onTasksUpdatedRef.current = onTasksUpdated;
  }, [onTasksUpdated]);

  useEffect(() => {
    onLearningsUpdatedRef.current = onLearningsUpdated;
  }, [onLearningsUpdated]);

  // 通知音の初期化
  // Note: /public/notification.mp3 を配置すると通知音が再生される
  useEffect(() => {
    if (enableSound) {
      const audio = new Audio("/notification.mp3");
      audio.volume = 0.5;
      // ファイルが存在しない場合のエラーを無視
      audio.addEventListener("error", () => {
        audioRef.current = null;
      });
      audioRef.current = audio;
    }
    return () => {
      audioRef.current = null;
    };
  }, [enableSound]);

  // Web通知の許可状態を取得
  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  // Web通知の許可をリクエスト
  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) return;

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }, []);

  // 通知を表示
  const showNotification = useCallback(
    (event: AIJobCompletedEvent) => {
      const label = JOB_TYPE_LABELS[event.jobType] || event.jobType;
      const message = event.resultSummary || `${label}が完了しました`;

      // トースト通知
      if (enableToast) {
        if (event.status === "completed") {
          toast.success(message, {
            description: label,
            duration: 5000,
          });
        } else if (event.status === "failed") {
          toast.error("ジョブが失敗しました", {
            description: message,
            duration: 5000,
          });
        }
      }

      // Web通知 (バックグラウンド時)
      if (enableWebNotification && notificationPermission === "granted" && document.hidden) {
        new Notification(label, {
          body: message,
          icon: "/favicon.ico",
          tag: `ai-job-${event.jobId}`,
        });
      }

      // 通知音
      if (enableSound && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {
          // 自動再生がブロックされた場合は無視
        });
      }

      // タスク更新コールバック
      if (
        event.jobType.startsWith("task-extract") ||
        event.jobType === "task-elaborate" ||
        event.jobType === "profile-analyze"
      ) {
        onTasksUpdatedRef.current?.();
      }

      // 学び更新コールバック
      if (event.jobType === "learning-extract") {
        onLearningsUpdatedRef.current?.();
      }
    },
    [enableToast, enableWebNotification, enableSound, notificationPermission],
  );

  // AI Jobs フックを使用
  const { stats, jobs, isConnected, refreshJobs } = useAIJobs({
    enableSSE: true,
    onJobCompleted: showNotification,
  });

  return {
    stats,
    jobs,
    isConnected,
    notificationPermission,
    requestNotificationPermission,
    refreshJobs,
  };
}
