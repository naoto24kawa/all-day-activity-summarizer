/**
 * Bulk Elaborate Dialog
 *
 * 複数タスクを一括で AI 詳細化するダイアログ
 * - 入力フェーズ: 追加指示の入力
 * - 処理中フェーズ: AI 処理中の進捗表示
 * - レビューフェーズ: 結果のレビュー・個別採用/却下
 */

import type {
  BulkElaborateTaskResult,
  BulkElaborateTasksRequest,
  BulkElaborateTasksResponse,
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
import { useCallback, useEffect, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

type DialogPhase = "input" | "processing" | "review";

interface BulkElaborateDialogProps {
  open: boolean;
  tasks: Task[];
  projects: Project[];
  onBulkElaborate: (request: BulkElaborateTasksRequest) => Promise<BulkElaborateTasksResponse>;
  onApply: (taskId: number, description: string) => Promise<void>;
  onClose: () => void;
}

interface ReviewItem {
  taskId: number;
  taskTitle: string;
  elaboration: string;
  referencedFiles?: string[];
  selected: boolean;
  error?: string;
}

export function BulkElaborateDialog({
  open,
  tasks,
  projects,
  onBulkElaborate,
  onApply,
  onClose,
}: BulkElaborateDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>("input");
  const [userInstruction, setUserInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

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

  // ダイアログが閉じられたらリセット
  useEffect(() => {
    if (!open) {
      setPhase("input");
      setUserInstruction("");
      setError(null);
      setReviewItems([]);
      setExpandedItems(new Set());
    }
  }, [open]);

  // プロジェクト名を取得
  const getProjectName = (projectId: number | null): string | null => {
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId);
    return project?.name ?? null;
  };

  // 詳細化を実行
  const handleElaborate = useCallback(async () => {
    if (listening) {
      stopListening();
    }

    setPhase("processing");
    setError(null);

    try {
      const result = await onBulkElaborate({
        taskIds: tasks.map((t) => t.id),
        userInstruction: userInstruction.trim() || undefined,
      });

      // 結果をレビューアイテムに変換
      const items: ReviewItem[] = result.results.map((r: BulkElaborateTaskResult) => ({
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        elaboration: r.elaboration ?? "",
        referencedFiles: r.referencedFiles,
        selected: r.success,
        error: r.error,
      }));

      setReviewItems(items);
      // 成功したアイテムはデフォルトで展開
      setExpandedItems(new Set(items.filter((i) => !i.error).map((i) => i.taskId)));
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "詳細化に失敗しました");
      setPhase("input");
    }
  }, [tasks, userInstruction, listening, stopListening, onBulkElaborate]);

  // 適用
  const handleApply = useCallback(async () => {
    const selectedItems = reviewItems.filter((item) => item.selected && !item.error);

    if (selectedItems.length === 0) {
      setError("適用するタスクを選択してください");
      return;
    }

    setApplying(true);
    setError(null);

    try {
      for (const item of selectedItems) {
        await onApply(item.taskId, item.elaboration);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "適用に失敗しました");
    } finally {
      setApplying(false);
    }
  }, [reviewItems, onApply, onClose]);

  // 選択状態を切り替え
  const toggleItemSelection = (taskId: number) => {
    setReviewItems((prev) =>
      prev.map((item) => (item.taskId === taskId ? { ...item, selected: !item.selected } : item)),
    );
  };

  // 全て選択/解除
  const selectAll = () => {
    setReviewItems((prev) => prev.map((item) => (item.error ? item : { ...item, selected: true })));
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

  // 詳細化内容を編集
  const updateElaboration = (taskId: number, elaboration: string) => {
    setReviewItems((prev) =>
      prev.map((item) => (item.taskId === taskId ? { ...item, elaboration } : item)),
    );
  };

  // Cmd+Enter で実行
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (phase === "input") {
          handleElaborate();
        } else if (phase === "review" && !applying) {
          handleApply();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, phase, applying, handleElaborate, handleApply]);

  const handleClose = () => {
    if (listening) stopListening();
    onClose();
  };

  const selectedCount = reviewItems.filter((item) => item.selected && !item.error).length;
  const successCount = reviewItems.filter((item) => !item.error).length;

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
            <Button onClick={handleElaborate}>
              <Wand2 className="mr-2 h-4 w-4" />
              詳細化を実行
              <span className="ml-2 text-xs text-muted-foreground">(Cmd+Enter)</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // 処理中フェーズ
  if (phase === "processing") {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
              一括詳細化中...
            </DialogTitle>
            <DialogDescription>{tasks.length} 件のタスクを処理しています</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              コードベースを分析してタスクを詳細化しています...
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              1 タスクあたり 10-30 秒程度かかります
            </p>
          </div>
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
                    item.error
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
                        if (!item.error) {
                          toggleItemSelection(item.taskId);
                        }
                      }}
                      disabled={!!item.error}
                    >
                      {item.error ? (
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
                        {item.error ? (
                          <Badge variant="destructive" className="text-xs">
                            エラー
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <Check className="mr-1 h-3 w-3" />
                            成功
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
                  {!item.error && (
                    <CollapsibleContent>
                      <div className="mt-3 space-y-2">
                        <Textarea
                          value={item.elaboration}
                          onChange={(e) => updateElaboration(item.taskId, e.target.value)}
                          rows={8}
                          className="font-mono text-xs"
                        />
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
