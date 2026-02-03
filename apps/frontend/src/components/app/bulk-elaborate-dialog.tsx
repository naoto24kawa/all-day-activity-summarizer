/**
 * Bulk Elaborate Dialog
 *
 * 複数タスクを一括で AI 詳細化するダイアログ
 * - 入力フェーズ: 追加指示の入力
 * - ポーリングフェーズ: 非同期処理の進捗監視
 * - レビューフェーズ: 結果のレビュー・個別採用/却下
 */

import type {
  ApplyElaborationRequest,
  BulkElaborateStartResponse,
  BulkElaborateTasksRequest,
  BulkElaborationStatusResponse,
  ElaborationResult,
  Project,
  Task,
} from "@repo/types";
import {
  AlertCircle,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  MicOff,
  Square,
  Wand2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { fetchAdasApi } from "@/lib/adas-api";

type DialogPhase = "input" | "polling" | "review";

interface BulkElaborateDialogProps {
  open: boolean;
  tasks: Task[];
  projects: Project[];
  onStartBulkElaborate: (request: BulkElaborateTasksRequest) => Promise<BulkElaborateStartResponse>;
  onGetBulkElaborationStatus: (taskIds: number[]) => Promise<BulkElaborationStatusResponse>;
  onApplyElaboration: (taskId: number, request?: ApplyElaborationRequest) => Promise<unknown>;
  onRefetch: () => Promise<void>;
  onClose: () => void;
}

interface ReviewItem {
  taskId: number;
  taskTitle: string;
  elaboration: string;
  childTasks?: Array<{ title: string; description: string | null; stepNumber: number }>;
  referencedFiles?: string[];
  selected: boolean;
  status: "pending" | "completed" | "failed";
  error?: string;
}

const POLLING_INTERVAL = 3000; // 3秒間隔

export function BulkElaborateDialog({
  open,
  tasks,
  projects,
  onStartBulkElaborate,
  onGetBulkElaborationStatus,
  onApplyElaboration,
  onRefetch,
  onClose,
}: BulkElaborateDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>("input");
  const [userInstruction, setUserInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // ポーリング用
  const [pollingTaskIds, setPollingTaskIds] = useState<number[]>([]);
  const [pollingStatus, setPollingStatus] = useState<BulkElaborationStatusResponse | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pollingErrorCount, setPollingErrorCount] = useState(0);
  const MAX_POLLING_ERRORS = 5;

  // レビュー結果
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  // 音声認識
  const {
    listening,
    startListening,
    stopListening,
    isSupported: speechSupported,
  } = useSpeechRecognition({
    onTranscriptChange: (transcript) => setUserInstruction(transcript),
  });

  // ポーリングをクリーンアップ
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // ダイアログが閉じられたらリセット
  useEffect(() => {
    if (!open) {
      stopPolling();
      setPhase("input");
      setUserInstruction("");
      setError(null);
      setPollingTaskIds([]);
      setPollingStatus(null);
      setPollingErrorCount(0);
      setReviewItems([]);
      setExpandedItems(new Set());
    }
  }, [open, stopPolling]);

  // プロジェクト名を取得
  const getProjectName = (projectId: number | null): string | null => {
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId);
    return project?.name ?? null;
  };

  // 詳細化結果を取得してレビューアイテムに変換
  const fetchElaborationResults = useCallback(
    async (taskIds: number[]) => {
      const items: ReviewItem[] = [];

      for (const taskId of taskIds) {
        try {
          // タスクの詳細を取得
          const taskData = await fetchAdasApi<Task>(`/api/tasks/${taskId}`);
          const task = tasks.find((t) => t.id === taskId);

          if (taskData.elaborationStatus === "completed" && taskData.pendingElaboration) {
            const result: ElaborationResult = JSON.parse(taskData.pendingElaboration);
            items.push({
              taskId,
              taskTitle: task?.title ?? `Task #${taskId}`,
              elaboration: result.elaboration,
              childTasks: result.childTasks,
              referencedFiles: result.referencedFiles,
              selected: true,
              status: "completed",
            });
          } else if (taskData.elaborationStatus === "failed") {
            items.push({
              taskId,
              taskTitle: task?.title ?? `Task #${taskId}`,
              elaboration: "",
              selected: false,
              status: "failed",
              error: "詳細化に失敗しました",
            });
          }
        } catch {
          const task = tasks.find((t) => t.id === taskId);
          items.push({
            taskId,
            taskTitle: task?.title ?? `Task #${taskId}`,
            elaboration: "",
            selected: false,
            status: "failed",
            error: "詳細化結果の取得に失敗しました",
          });
        }
      }

      return items;
    },
    [tasks],
  );

  // ポーリング処理
  const pollStatus = useCallback(async () => {
    if (pollingTaskIds.length === 0) return;

    try {
      const status = await onGetBulkElaborationStatus(pollingTaskIds);
      setPollingStatus(status);
      setPollingErrorCount(0); // 成功したらエラーカウントをリセット

      if (status.allCompleted) {
        stopPolling();

        // 詳細化結果を取得
        const items = await fetchElaborationResults(pollingTaskIds);
        setReviewItems(items);
        setExpandedItems(
          new Set(items.filter((i) => i.status === "completed").map((i) => i.taskId)),
        );
        setPhase("review");
      }
    } catch (err) {
      console.error("Failed to poll elaboration status:", err);
      setPollingErrorCount((prev) => {
        const newCount = prev + 1;
        if (newCount >= MAX_POLLING_ERRORS) {
          stopPolling();
          setError("サーバーとの接続に失敗しました。ページをリロードしてください。");
        }
        return newCount;
      });
    }
  }, [pollingTaskIds, onGetBulkElaborationStatus, stopPolling, fetchElaborationResults]);

  // ポーリング開始
  useEffect(() => {
    if (phase === "polling" && pollingTaskIds.length > 0 && !pollingIntervalRef.current) {
      // 即座に1回実行
      pollStatus();
      // 定期ポーリング開始
      pollingIntervalRef.current = setInterval(pollStatus, POLLING_INTERVAL);
    }

    return () => {
      if (phase !== "polling") {
        stopPolling();
      }
    };
  }, [phase, pollingTaskIds, pollStatus, stopPolling]);

  // 詳細化を開始
  const handleStartElaborate = useCallback(async () => {
    if (listening) {
      stopListening();
    }

    setPhase("polling");
    setError(null);

    try {
      const result = await onStartBulkElaborate({
        taskIds: tasks.map((t) => t.id),
        userInstruction: userInstruction.trim() || undefined,
      });

      setPollingTaskIds(result.taskIds);

      // 初期レビューアイテムを設定 (全て pending 状態)
      setReviewItems(
        tasks.map((task) => ({
          taskId: task.id,
          taskTitle: task.title,
          elaboration: "",
          selected: false,
          status: "pending" as const,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "詳細化の開始に失敗しました");
      setPhase("input");
    }
  }, [tasks, userInstruction, listening, stopListening, onStartBulkElaborate]);

  // 適用
  const handleApply = useCallback(async () => {
    const selectedItems = reviewItems.filter(
      (item) => item.selected && item.status === "completed",
    );

    if (selectedItems.length === 0) {
      setError("適用するタスクを選択してください");
      return;
    }

    setApplying(true);
    setError(null);

    try {
      for (const item of selectedItems) {
        await onApplyElaboration(item.taskId, {
          updateParentDescription: true,
          createChildTasks: true,
        });
      }
      await onRefetch();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "適用に失敗しました");
    } finally {
      setApplying(false);
    }
  }, [reviewItems, onApplyElaboration, onRefetch, onClose]);

  // 選択状態を切り替え
  const toggleItemSelection = (taskId: number) => {
    setReviewItems((prev) =>
      prev.map((item) => (item.taskId === taskId ? { ...item, selected: !item.selected } : item)),
    );
  };

  // 全て選択/解除
  const selectAll = () => {
    setReviewItems((prev) =>
      prev.map((item) => (item.status === "completed" ? { ...item, selected: true } : item)),
    );
  };

  const deselectAll = () => {
    setReviewItems((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  // 展開状態を切り替え
  const toggleItemExpanded = (taskId: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  // 再試行ハンドラー (すべての早期リターンの前に定義)
  const handleRetryPolling = useCallback(() => {
    setError(null);
    setPollingErrorCount(0);
    // ポーリングを再開
    if (pollingTaskIds.length > 0 && !pollingIntervalRef.current) {
      pollStatus();
      pollingIntervalRef.current = setInterval(pollStatus, POLLING_INTERVAL);
    }
  }, [pollingTaskIds, pollStatus]);

  // Cmd+Enter で実行
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (phase === "input") {
          handleStartElaborate();
        } else if (phase === "review" && !applying) {
          handleApply();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, phase, applying, handleStartElaborate, handleApply]);

  const handleClose = () => {
    if (listening) stopListening();
    stopPolling();
    onClose();
  };

  const selectedCount = reviewItems.filter(
    (item) => item.selected && item.status === "completed",
  ).length;
  const successCount = reviewItems.filter((item) => item.status === "completed").length;

  // 入力フェーズ
  if (phase === "input") {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-purple-500" />
              タスクを一括詳細化
            </DialogTitle>
            <DialogDescription>{tasks.length} 件のタスクを AI で詳細化します</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">対象タスク</Label>
              <ScrollArea className="mt-2 h-32 rounded-md border p-2">
                <ul className="space-y-1">
                  {tasks.map((task) => (
                    <li key={task.id} className="text-sm">
                      <span className="font-medium">{task.title}</span>
                      {task.projectId && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {getProjectName(task.projectId)}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-instruction">追加の指示 (任意・全タスク共通)</Label>
              <div className="relative">
                <Textarea
                  id="user-instruction"
                  placeholder="例: 実装手順をもっと詳しく、テストの観点も含めて"
                  value={userInstruction}
                  onChange={(e) => setUserInstruction(e.target.value)}
                  rows={3}
                  className="pr-10"
                />
                {speechSupported && (
                  <Button
                    type="button"
                    variant={listening ? "destructive" : "ghost"}
                    size="icon"
                    className="absolute right-2 bottom-2 h-8 w-8"
                    onClick={() => (listening ? stopListening() : startListening(userInstruction))}
                    title={listening ? "音声入力を停止" : "音声入力"}
                  >
                    {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleClose}>
              キャンセル
            </Button>
            <Button onClick={handleStartElaborate}>
              <Wand2 className="mr-2 h-4 w-4" />
              詳細化を実行
              <span className="ml-2 text-xs text-muted-foreground">(Cmd+Enter)</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ポーリングフェーズ
  if (phase === "polling") {
    const progress = pollingStatus
      ? ((pollingStatus.summary.completed + pollingStatus.summary.failed) /
          pollingStatus.summary.total) *
        100
      : 0;

    const hasPollingError = pollingErrorCount >= MAX_POLLING_ERRORS;

    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {hasPollingError ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
              )}
              {hasPollingError ? "接続エラー" : "一括詳細化中..."}
            </DialogTitle>
            <DialogDescription>
              {hasPollingError
                ? "サーバーとの接続に問題が発生しました"
                : `${tasks.length} 件のタスクを処理しています`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Progress value={progress} className="h-2" />

            <div className="text-center text-sm text-muted-foreground">
              {hasPollingError ? (
                <span className="text-destructive">
                  ステータスの取得に失敗しました。バックグラウンドで処理は継続している可能性があります。
                </span>
              ) : pollingStatus ? (
                <>
                  <span className="font-medium">
                    {pollingStatus.summary.completed + pollingStatus.summary.failed}
                  </span>{" "}
                  / {pollingStatus.summary.total} 件完了
                  {pollingStatus.summary.failed > 0 && (
                    <span className="ml-2 text-destructive">
                      ({pollingStatus.summary.failed} 件失敗)
                    </span>
                  )}
                </>
              ) : (
                "処理を開始しています..."
              )}
            </div>

            <div className="space-y-2">
              {reviewItems.map((item) => (
                <div
                  key={item.taskId}
                  className="flex items-center gap-2 text-sm rounded-md border p-2"
                >
                  {item.status === "pending" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : item.status === "completed" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className="flex-1 truncate">{item.taskTitle}</span>
                </div>
              ))}
            </div>

            {!hasPollingError && (
              <p className="text-xs text-center text-muted-foreground">
                1 タスクあたり 10-30 秒程度かかります
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleClose}>
              {hasPollingError ? "閉じる" : "バックグラウンドで実行"}
            </Button>
            {hasPollingError && <Button onClick={handleRetryPolling}>再試行</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // レビューフェーズ
  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>詳細化結果のレビュー</DialogTitle>
          <DialogDescription>
            {successCount} 件成功、{reviewItems.length - successCount} 件失敗
            {selectedCount > 0 && ` (${selectedCount} 件選択中)`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 shrink-0 pb-2 border-b">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={successCount === 0}>
            <CheckSquare className="mr-1 h-3 w-3" />
            全て選択
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll}>
            <Square className="mr-1 h-3 w-3" />
            全て解除
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-3 pr-4">
            {reviewItems.map((item) => (
              <Collapsible
                key={item.taskId}
                open={expandedItems.has(item.taskId)}
                onOpenChange={() => toggleItemExpanded(item.taskId)}
              >
                <div
                  className={`rounded-md border p-3 ${
                    item.status === "failed"
                      ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                      : item.selected
                        ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
                        : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* 選択チェックボックス */}
                    <button
                      type="button"
                      className="mt-0.5 p-0.5 rounded hover:bg-muted/50 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.status === "completed") {
                          toggleItemSelection(item.taskId);
                        }
                      }}
                      disabled={item.status !== "completed"}
                    >
                      {item.status === "failed" ? (
                        <XCircle className="h-5 w-5 text-red-500" />
                      ) : item.selected ? (
                        <CheckSquare className="h-5 w-5 text-blue-500" />
                      ) : (
                        <Square className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>

                    {/* タイトル・展開トリガー */}
                    <CollapsibleTrigger className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{item.taskTitle}</span>
                        {item.status === "failed" ? (
                          <Badge variant="destructive" className="text-xs">
                            エラー
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <Check className="mr-1 h-3 w-3" />
                            成功
                          </Badge>
                        )}
                        {item.childTasks && item.childTasks.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {item.childTasks.length} ステップ
                          </Badge>
                        )}
                      </div>
                      {item.error && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{item.error}</p>
                      )}
                    </CollapsibleTrigger>

                    {/* 展開アイコン */}
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        {expandedItems.has(item.taskId) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </div>

                  {/* 展開コンテンツ */}
                  {item.status === "completed" && (
                    <CollapsibleContent>
                      <div className="mt-3 space-y-3">
                        {/* 詳細説明 */}
                        <div>
                          <Label className="text-xs text-muted-foreground">詳細説明</Label>
                          <div className="mt-1 p-2 rounded border bg-muted/30 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {item.elaboration}
                          </div>
                        </div>

                        {/* 子タスク */}
                        {item.childTasks && item.childTasks.length > 0 && (
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              実装ステップ ({item.childTasks.length} 件)
                            </Label>
                            <ul className="mt-1 space-y-1">
                              {item.childTasks.map((child) => (
                                <li
                                  key={child.stepNumber}
                                  className="text-xs p-2 rounded border bg-muted/30"
                                >
                                  <span className="font-medium">
                                    {child.stepNumber}. {child.title}
                                  </span>
                                  {child.description && (
                                    <p className="mt-0.5 text-muted-foreground line-clamp-2">
                                      {child.description}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* 参照ファイル */}
                        {item.referencedFiles && item.referencedFiles.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            参照ファイル: {item.referencedFiles.slice(0, 3).join(", ")}
                            {item.referencedFiles.length > 3 &&
                              ` 他 ${item.referencedFiles.length - 3} 件`}
                          </p>
                        )}
                      </div>
                    </CollapsibleContent>
                  )}
                </div>
              </Collapsible>
            ))}
          </div>
        </ScrollArea>

        {error && (
          <div className="shrink-0 flex items-center gap-2 text-sm text-destructive pt-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <DialogFooter className="shrink-0 gap-2 sm:gap-0 pt-4 border-t">
          <Button variant="outline" onClick={handleClose}>
            キャンセル
          </Button>
          <Button onClick={handleApply} disabled={applying || selectedCount === 0}>
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {selectedCount} 件を適用
            <span className="ml-2 text-xs text-muted-foreground">(Cmd+Enter)</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
