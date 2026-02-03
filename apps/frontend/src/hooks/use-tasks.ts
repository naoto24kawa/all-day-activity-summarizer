/**
 * Tasks Hook
 */

import type {
  ApplyCompletionCheckResponse,
  ApplyElaborationRequest,
  ApplyElaborationResponse,
  BulkElaborateStartResponse,
  BulkElaborateTasksRequest,
  BulkElaborationStatusResponse,
  CheckSimilarityBatchRequest,
  CheckSimilarityBatchResponse,
  CheckTaskSimilarityResponse,
  ChildTasksResponse,
  CompletionCheckStatusResponse,
  CreateGitHubIssueRequest,
  CreateGitHubIssueResponse,
  CreateMergeTaskResponse,
  DetectDuplicatesResponse,
  ElaborateTaskRequest,
  ElaborateTaskResponse,
  ElaborationStatusResponse,
  StartCompletionCheckResponse,
  StartElaborationResponse,
  Task,
  TaskStats,
  TaskStatus,
  WorkType,
} from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, patchAdasApi, postAdasApi } from "@/lib/adas-api";

export function useTasks(status?: TaskStatus) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(
    async (silent = false, overrideStatus?: TaskStatus) => {
      try {
        if (!silent) setLoading(true);
        const targetStatus = overrideStatus ?? status;
        const params = new URLSearchParams();
        if (targetStatus) {
          params.set("status", targetStatus);
        }
        const url = params.toString() ? `/api/tasks?${params}` : "/api/tasks";
        const data = await fetchAdasApi<Task[]>(url);
        setTasks(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch tasks");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  type TaskUpdates = {
    status?: TaskStatus;
    priority?: "high" | "medium" | "low" | null;
    workType?: WorkType | null;
    dueDate?: string | null;
    rejectReason?: string;
    title?: string;
    description?: string;
    projectId?: number | null;
  };

  // 同期版 (従来の動作)
  const updateTask = useCallback(
    async (id: number, updates: TaskUpdates): Promise<Task> => {
      const result = await patchAdasApi<Task>(`/api/tasks/${id}`, updates);
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // 楽観的更新版 (UIを即座に更新し、バックグラウンドでAPI呼び出し)
  const updateTaskOptimistic = useCallback(
    (id: number, updates: TaskUpdates): { promise: Promise<Task>; rollback: () => void } => {
      // 現在の状態を保存 (ロールバック用)
      const previousTasks = tasks;

      // UIを即座に更新
      setTasks((prev) =>
        prev.map((task) =>
          task.id === id ? { ...task, ...updates, updatedAt: new Date().toISOString() } : task,
        ),
      );

      // バックグラウンドでAPI呼び出し
      const promise = patchAdasApi<Task>(`/api/tasks/${id}`, updates).then(async (result) => {
        // 成功したら最新データで同期
        await fetchTasks(true);
        return result;
      });

      // ロールバック関数
      const rollback = () => {
        setTasks(previousTasks);
      };

      return { promise, rollback };
    },
    [tasks, fetchTasks],
  );

  const deleteTask = useCallback(
    async (id: number) => {
      await deleteAdasApi(`/api/tasks/${id}`);
      await fetchTasks(true);
    },
    [fetchTasks],
  );

  // 抽出関数のファクトリー (重複コード削減)
  type ExtractResult = { extracted: number; tasks: Task[] };
  type AsyncExtractResult = { jobId: number; status: string };

  const createExtractFn = useCallback(
    <T extends object>(endpoint: string) =>
      async (options?: T): Promise<ExtractResult> => {
        const result = await postAdasApi<ExtractResult>(endpoint, options ?? {});
        await fetchTasks(true);
        return result;
      },
    [fetchTasks],
  );

  const createAsyncExtractFn = useCallback(
    <T extends object>(endpoint: string) =>
      async (options?: T): Promise<AsyncExtractResult> => {
        const result = await postAdasApi<AsyncExtractResult>(endpoint, options ?? {});
        return result;
      },
    [],
  );

  const extractTasks = useCallback(
    (options?: { date?: string; messageIds?: number[] }) =>
      createExtractFn<{ date?: string; messageIds?: number[] }>("/api/tasks/extract")(options),
    [createExtractFn],
  );

  const extractGitHubTasks = useCallback(
    (options?: { date?: string }) =>
      createExtractFn<{ date?: string }>("/api/tasks/extract-github")(options),
    [createExtractFn],
  );

  const extractGitHubCommentTasks = useCallback(
    (options?: { date?: string }) =>
      createExtractFn<{ date?: string }>("/api/tasks/extract-github-comments")(options),
    [createExtractFn],
  );

  const extractMemoTasks = useCallback(
    (options?: { date?: string; memoIds?: number[] }) =>
      createExtractFn<{ date?: string; memoIds?: number[] }>("/api/tasks/extract-memos")(options),
    [createExtractFn],
  );

  // 非同期版: ジョブをキューに登録して即座にレスポンスを返す
  const extractTasksAsync = useCallback(
    (options?: { date?: string; messageIds?: number[] }) =>
      createAsyncExtractFn<{ date?: string; messageIds?: number[] }>("/api/tasks/extract/async")(
        options,
      ),
    [createAsyncExtractFn],
  );

  const extractGitHubTasksAsync = useCallback(
    (options?: { date?: string }) =>
      createAsyncExtractFn<{ date?: string }>("/api/tasks/extract-github/async")(options),
    [createAsyncExtractFn],
  );

  const extractGitHubCommentTasksAsync = useCallback(
    (options?: { date?: string }) =>
      createAsyncExtractFn<{ date?: string }>("/api/tasks/extract-github-comments/async")(options),
    [createAsyncExtractFn],
  );

  const extractMemoTasksAsync = useCallback(
    (options?: { date?: string }) =>
      createAsyncExtractFn<{ date?: string }>("/api/tasks/extract-memos/async")(options),
    [createAsyncExtractFn],
  );

  const updateBatchTasks = useCallback(
    async (
      ids: number[],
      updates: {
        status?: TaskStatus;
        projectId?: number | null;
        priority?: "high" | "medium" | "low" | null;
        reason?: string;
      },
    ) => {
      const result = await patchAdasApi<{ updated: number; tasks: Task[] }>("/api/tasks/batch", {
        ids,
        ...updates,
      });
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  const detectDuplicates = useCallback(
    async (options?: { date?: string; projectId?: number; minSimilarity?: number }) => {
      const result = await postAdasApi<DetectDuplicatesResponse>(
        "/api/tasks/detect-duplicates",
        options ?? {},
      );
      return result;
    },
    [],
  );

  const createMergeTask = useCallback(
    async (options: {
      sourceTaskIds: number[];
      title: string;
      description?: string;
      priority?: "high" | "medium" | "low";
      projectId?: number;
    }) => {
      const result = await postAdasApi<CreateMergeTaskResponse>("/api/tasks/merge", options);
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // 非同期詳細化を開始
  const startElaborate = useCallback(
    async (taskId: number, request?: ElaborateTaskRequest): Promise<StartElaborationResponse> => {
      const result = await postAdasApi<StartElaborationResponse>(
        `/api/tasks/${taskId}/elaborate`,
        request ?? {},
      );
      return result;
    },
    [],
  );

  // 詳細化状態を取得
  const getElaborationStatus = useCallback(
    async (taskId: number): Promise<ElaborationStatusResponse> => {
      const result = await fetchAdasApi<ElaborationStatusResponse>(
        `/api/tasks/${taskId}/elaboration`,
      );
      return result;
    },
    [],
  );

  // 詳細化結果を適用
  const applyElaboration = useCallback(
    async (
      taskId: number,
      request?: ApplyElaborationRequest,
    ): Promise<ApplyElaborationResponse> => {
      const result = await postAdasApi<ApplyElaborationResponse>(
        `/api/tasks/${taskId}/elaboration/apply`,
        request ?? {},
      );
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // 詳細化結果を破棄
  const discardElaboration = useCallback(
    async (taskId: number): Promise<{ discarded: boolean }> => {
      const result = await postAdasApi<{ discarded: boolean }>(
        `/api/tasks/${taskId}/elaboration/discard`,
        {},
      );
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // 子タスク一覧を取得
  const getChildTasks = useCallback(async (taskId: number): Promise<ChildTasksResponse> => {
    const result = await fetchAdasApi<ChildTasksResponse>(`/api/tasks/${taskId}/children`);
    return result;
  }, []);

  // 同期版 (後方互換性のため残す) - 実際は非同期で動作
  const elaborateTask = useCallback(
    async (taskId: number, request?: ElaborateTaskRequest): Promise<ElaborateTaskResponse> => {
      // 非同期で開始
      await startElaborate(taskId, request);

      // ポーリングで完了を待つ
      let status: ElaborationStatusResponse;
      const maxAttempts = 60; // 最大3分 (3秒 x 60)
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        status = await getElaborationStatus(taskId);

        if (status.status === "completed" && status.result) {
          return {
            elaboration: status.result.elaboration,
            codebaseReferenced: status.result.referencedFiles?.length > 0,
            referencedFiles: status.result.referencedFiles,
          };
        }

        if (status.status === "failed") {
          throw new Error(status.errorMessage ?? "詳細化に失敗しました");
        }
      }

      throw new Error("詳細化がタイムアウトしました");
    },
    [startElaborate, getElaborationStatus],
  );

  // 一括詳細化を非同期で開始
  const startBulkElaborate = useCallback(
    async (request: BulkElaborateTasksRequest): Promise<BulkElaborateStartResponse> => {
      const result = await postAdasApi<BulkElaborateStartResponse>(
        "/api/tasks/bulk-elaborate",
        request,
      );
      return result;
    },
    [],
  );

  // 一括詳細化の状態を取得
  const getBulkElaborationStatus = useCallback(
    async (taskIds: number[]): Promise<BulkElaborationStatusResponse> => {
      const params = new URLSearchParams();
      params.set("taskIds", taskIds.join(","));
      const result = await fetchAdasApi<BulkElaborationStatusResponse>(
        `/api/tasks/bulk-elaboration-status?${params}`,
      );
      return result;
    },
    [],
  );

  // 個別タスクの類似チェック
  const checkTaskSimilarity = useCallback(
    async (taskId: number): Promise<CheckTaskSimilarityResponse> => {
      const result = await postAdasApi<CheckTaskSimilarityResponse>(
        `/api/tasks/${taskId}/check-similarity`,
        {},
      );
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // 一括類似チェック
  const checkSimilarityBatch = useCallback(
    async (request?: CheckSimilarityBatchRequest): Promise<CheckSimilarityBatchResponse> => {
      const result = await postAdasApi<CheckSimilarityBatchResponse>(
        "/api/tasks/check-similarity-batch",
        request ?? {},
      );
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // GitHub Issue 作成
  const createGitHubIssue = useCallback(
    async (
      taskId: number,
      request?: CreateGitHubIssueRequest,
    ): Promise<CreateGitHubIssueResponse> => {
      const result = await postAdasApi<CreateGitHubIssueResponse>(
        `/api/tasks/${taskId}/create-issue`,
        request ?? {},
      );
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // ========== 完了チェック API ==========

  // 完了チェックを開始
  const startCompletionCheck = useCallback(
    async (taskId: number): Promise<StartCompletionCheckResponse> => {
      const result = await postAdasApi<StartCompletionCheckResponse>(
        `/api/tasks/${taskId}/check-completion`,
        {},
      );
      return result;
    },
    [],
  );

  // 完了チェック状態を取得
  const getCompletionCheckStatus = useCallback(
    async (taskId: number): Promise<CompletionCheckStatusResponse> => {
      const result = await fetchAdasApi<CompletionCheckStatusResponse>(
        `/api/tasks/${taskId}/completion-check`,
      );
      return result;
    },
    [],
  );

  // 完了チェック結果を適用 (タスクを完了にする)
  const applyCompletionCheck = useCallback(
    async (taskId: number): Promise<ApplyCompletionCheckResponse> => {
      const result = await postAdasApi<ApplyCompletionCheckResponse>(
        `/api/tasks/${taskId}/completion-check/apply`,
        {},
      );
      await fetchTasks(true);
      return result;
    },
    [fetchTasks],
  );

  // 完了チェック結果を破棄
  const discardCompletionCheck = useCallback(
    async (taskId: number): Promise<{ discarded: boolean }> => {
      const result = await postAdasApi<{ discarded: boolean }>(
        `/api/tasks/${taskId}/completion-check/discard`,
        {},
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
    updateTaskOptimistic,
    updateBatchTasks,
    deleteTask,
    extractTasks,
    extractGitHubTasks,
    extractGitHubCommentTasks,
    extractMemoTasks,
    extractTasksAsync,
    extractGitHubTasksAsync,
    extractGitHubCommentTasksAsync,
    extractMemoTasksAsync,
    detectDuplicates,
    createMergeTask,
    // 非同期詳細化 API
    startElaborate,
    getElaborationStatus,
    applyElaboration,
    discardElaboration,
    getChildTasks,
    // 後方互換性のため残す
    elaborateTask,
    // 一括詳細化 (非同期)
    startBulkElaborate,
    getBulkElaborationStatus,
    // 類似チェック
    checkTaskSimilarity,
    checkSimilarityBatch,
    // GitHub Issue 作成
    createGitHubIssue,
    // 完了チェック
    startCompletionCheck,
    getCompletionCheckStatus,
    applyCompletionCheck,
    discardCompletionCheck,
  };
}

export function useTaskStats(date?: string) {
  const [stats, setStats] = useState<TaskStats>({
    total: 0,
    pending: 0,
    accepted: 0,
    in_progress: 0,
    paused: 0,
    rejected: 0,
    completed: 0,
    someday: 0,
    acceptedByPriority: {
      high: 0,
      medium: 0,
      low: 0,
    },
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
