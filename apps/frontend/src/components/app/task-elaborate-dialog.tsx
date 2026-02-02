/**
 * Task Elaborate Dialog
 *
 * タスクを AI で詳細化するダイアログ
 * - 入力フェーズ: 追加指示の入力 (音声入力対応)
 * - ポーリングフェーズ: 非同期処理の完了を待つ
 * - プレビューフェーズ: 結果のプレビュー、編集、子タスクの確認
 *
 * リロード耐性: elaboration_status を確認して適切なフェーズから再開
 */

import type {
  ApplyElaborationRequest,
  ApplyElaborationResponse,
  ElaborationChildTask,
  ElaborationLevel,
  ElaborationResult,
  ElaborationStatusResponse,
  Project,
  StartElaborationResponse,
  Task,
} from "@repo/types";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

type DialogPhase = "input" | "polling" | "preview";

interface TaskElaborateDialogProps {
  open: boolean;
  task: Task;
  project: Project | null;
  onStartElaborate: (
    taskId: number,
    request?: { userInstruction?: string; level?: ElaborationLevel },
  ) => Promise<StartElaborationResponse>;
  onGetElaborationStatus: (taskId: number) => Promise<ElaborationStatusResponse>;
  onApplyElaboration: (
    taskId: number,
    request?: ApplyElaborationRequest,
  ) => Promise<ApplyElaborationResponse>;
  onDiscardElaboration: (taskId: number) => Promise<{ discarded: boolean }>;
  onClose: () => void;
}

interface ChildTaskEdit {
  stepNumber: number;
  title: string;
  description: string;
  include: boolean;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex dialog component
export function TaskElaborateDialog({
  open,
  task,
  project,
  onStartElaborate,
  onGetElaborationStatus,
  onApplyElaboration,
  onDiscardElaboration,
  onClose,
}: TaskElaborateDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>("input");
  const [userInstruction, setUserInstruction] = useState("");
  const [elaborationLevel, setElaborationLevel] = useState<ElaborationLevel>("standard");
  const [elaborationResult, setElaborationResult] = useState<ElaborationResult | null>(null);
  const [childTaskEdits, setChildTaskEdits] = useState<ChildTaskEdit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [originalExpanded, setOriginalExpanded] = useState(false);
  const [childTasksExpanded, setChildTasksExpanded] = useState(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 音声認識 (入力フェーズ用)
  const {
    listening: inputListening,
    startListening: startInputListening,
    stopListening: stopInputListening,
    isSupported: speechSupported,
  } = useSpeechRecognition({
    onTranscriptChange: (transcript) => setUserInstruction(transcript),
  });

  // ポーリングを停止
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // 子タスクの編集状態を初期化
  const initializeChildTaskEdits = useCallback((childTasks: ElaborationChildTask[]) => {
    setChildTaskEdits(
      childTasks.map((ct) => ({
        stepNumber: ct.stepNumber,
        title: ct.title,
        description: ct.description ?? "",
        include: true,
      })),
    );
  }, []);

  // ポーリングを開始
  const startPolling = useCallback(() => {
    stopPolling();

    const poll = async () => {
      try {
        const status = await onGetElaborationStatus(task.id);

        if (status.status === "completed" && status.result) {
          stopPolling();
          setElaborationResult(status.result);
          initializeChildTaskEdits(status.result.childTasks);
          setUserInstruction(""); // 修正指示入力欄をクリア
          setPhase("preview");
        } else if (status.status === "failed") {
          stopPolling();
          setError(status.errorMessage ?? "詳細化に失敗しました");
          setPhase("input");
        }
        // pending/processing の場合は継続
      } catch (err) {
        stopPolling();
        setError(err instanceof Error ? err.message : "ステータス取得に失敗しました");
        setPhase("input");
      }
    };

    // 即座に1回実行
    poll();

    // 3秒間隔でポーリング
    pollingRef.current = setInterval(poll, 3000);
  }, [task.id, onGetElaborationStatus, stopPolling, initializeChildTaskEdits]);

  // ダイアログが開かれた時に elaboration_status を確認
  useEffect(() => {
    if (!open) return;

    // タスクの elaboration_status に基づいて適切なフェーズを設定
    if (task.elaborationStatus === "pending") {
      setPhase("polling");
      startPolling();
    } else if (task.elaborationStatus === "completed" && task.pendingElaboration) {
      try {
        const result = JSON.parse(task.pendingElaboration) as ElaborationResult;
        setElaborationResult(result);
        initializeChildTaskEdits(result.childTasks);
        setUserInstruction(""); // 修正指示入力欄をクリア
        setPhase("preview");
      } catch {
        setPhase("input");
      }
    } else {
      setPhase("input");
    }
  }, [
    open,
    task.elaborationStatus,
    task.pendingElaboration,
    startPolling,
    initializeChildTaskEdits,
  ]);

  // ダイアログが閉じられたらリセット
  useEffect(() => {
    if (!open) {
      stopPolling();
      setPhase("input");
      setUserInstruction("");
      setElaborationLevel("standard");
      setElaborationResult(null);
      setChildTaskEdits([]);
      setError(null);
      setOriginalExpanded(false);
      setChildTasksExpanded(true);
    }
  }, [open, stopPolling]);

  // 詳細化を開始 (バックグラウンドで実行してモーダルを閉じる)
  const handleStartElaborate = useCallback(async () => {
    if (inputListening) {
      stopInputListening();
    }

    setError(null);

    try {
      await onStartElaborate(task.id, {
        userInstruction: userInstruction.trim() || undefined,
        level: elaborationLevel,
      });

      // モーダルを閉じてバックグラウンドで続行
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "詳細化の開始に失敗しました");
    }
  }, [
    task.id,
    userInstruction,
    elaborationLevel,
    inputListening,
    stopInputListening,
    onStartElaborate,
    onClose,
  ]);

  // 再生成 (バックグラウンドで実行してモーダルを閉じる)
  const handleRegenerate = useCallback(async () => {
    setError(null);

    try {
      await onStartElaborate(task.id, {
        userInstruction: userInstruction.trim() || undefined,
        level: elaborationLevel,
      });

      // モーダルを閉じてバックグラウンドで続行
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "再生成の開始に失敗しました");
    }
  }, [task.id, userInstruction, elaborationLevel, onStartElaborate, onClose]);

  // 子タスクの編集を更新
  const updateChildTaskEdit = (stepNumber: number, updates: Partial<ChildTaskEdit>) => {
    setChildTaskEdits((prev) =>
      prev.map((edit) => (edit.stepNumber === stepNumber ? { ...edit, ...updates } : edit)),
    );
  };

  // 適用
  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const request: ApplyElaborationRequest = {
        updateParentDescription: true,
        createChildTasks: childTaskEdits.some((e) => e.include),
        childTaskEdits: childTaskEdits.map((e) => ({
          stepNumber: e.stepNumber,
          title: e.title,
          description: e.description || undefined,
          include: e.include,
        })),
      };

      await onApplyElaboration(task.id, request);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "適用に失敗しました");
    } finally {
      setApplying(false);
    }
  }, [task.id, childTaskEdits, onApplyElaboration, onClose]);

  // 破棄
  const handleDiscard = useCallback(async () => {
    try {
      await onDiscardElaboration(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "破棄に失敗しました");
    }
  }, [task.id, onDiscardElaboration, onClose]);

  // Cmd+Enter で実行
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (phase === "input") {
          handleStartElaborate();
        } else if (phase === "preview" && !applying) {
          handleApply();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, phase, applying, handleStartElaborate, handleApply]);

  const handleClose = () => {
    if (inputListening) stopInputListening();
    stopPolling();
    onClose();
  };

  // 入力フェーズ
  if (phase === "input") {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">タスクを詳細化</DialogTitle>
            <DialogDescription>
              AI がコードベースを確認してタスクを詳細化し、実装ステップを提案します
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">タスク</Label>
              <p className="mt-1 text-sm">{task.title}</p>
            </div>

            {project && (
              <div>
                <Label className="text-sm font-medium">プロジェクト</Label>
                <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
                {!project.path && (
                  <p className="mt-1 text-xs text-yellow-600">
                    プロジェクトパスが未設定のため、コードベースを参照できません
                  </p>
                )}
              </div>
            )}

            {!project && (
              <p className="text-xs text-yellow-600">
                プロジェクトが未設定のため、コードベースを参照できません
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="elaboration-level">詳細度</Label>
              <Select
                value={elaborationLevel}
                onValueChange={(value) => setElaborationLevel(value as ElaborationLevel)}
              >
                <SelectTrigger id="elaboration-level">
                  <SelectValue placeholder="詳細度を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    <div className="flex flex-col items-start">
                      <span>簡潔</span>
                      <span className="text-xs text-muted-foreground">2-3ステップ、概要のみ</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="standard">
                    <div className="flex flex-col items-start">
                      <span>標準</span>
                      <span className="text-xs text-muted-foreground">3-5ステップ、適度な説明</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="detailed">
                    <div className="flex flex-col items-start">
                      <span>詳細</span>
                      <span className="text-xs text-muted-foreground">
                        5-7ステップ、具体的な手順
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-instruction">追加の指示 (任意)</Label>
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
                    variant={inputListening ? "destructive" : "ghost"}
                    size="icon"
                    className="absolute right-2 bottom-2 h-8 w-8"
                    onClick={() =>
                      inputListening ? stopInputListening() : startInputListening(userInstruction)
                    }
                    title={inputListening ? "音声入力を停止" : "音声入力"}
                  >
                    {inputListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
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
              詳細化を開始
              <span className="ml-2 text-xs text-muted-foreground">(Cmd+Enter)</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ポーリングフェーズ
  if (phase === "polling") {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
              詳細化中...
            </DialogTitle>
            <DialogDescription>AI がコードベースを確認しています</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              コードベースを分析してタスクを詳細化しています...
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              この処理には 10-30 秒程度かかる場合があります
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              ページをリロードしても処理は継続されます
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              バックグラウンドで続行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // プレビューフェーズ
  const includedChildTasks = childTaskEdits.filter((e) => e.include).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>詳細化結果のプレビュー</DialogTitle>
          <DialogDescription>結果を確認・編集してから適用してください</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2">
          {/* 元の説明 (折りたたみ可能) */}
          {task.description && (
            <Collapsible open={originalExpanded} onOpenChange={setOriginalExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex w-full items-center justify-start gap-2 px-2 text-muted-foreground hover:text-foreground"
                >
                  {originalExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">元の説明</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded-md border bg-muted/50 p-3">
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {task.description}
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* 詳細化された説明 */}
          <div className="space-y-2">
            <Label>詳細化された説明</Label>
            <div className="rounded-md border bg-muted/30 p-3 max-h-48 overflow-y-auto">
              <p className="whitespace-pre-wrap text-sm">{elaborationResult?.elaboration ?? ""}</p>
            </div>
          </div>

          {/* 参照ファイル */}
          {elaborationResult?.referencedFiles && elaborationResult.referencedFiles.length > 0 && (
            <div>
              <Label className="text-sm font-medium">参照ファイル</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {elaborationResult.referencedFiles.slice(0, 5).join(", ")}
                {elaborationResult.referencedFiles.length > 5 &&
                  ` 他 ${elaborationResult.referencedFiles.length - 5} 件`}
              </p>
            </div>
          )}

          {/* 子タスク (実装ステップ) */}
          {childTaskEdits.length > 0 && (
            <Collapsible open={childTasksExpanded} onOpenChange={setChildTasksExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex w-full items-center justify-start gap-2 px-2"
                >
                  {childTasksExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">
                    実装ステップ ({includedChildTasks}/{childTaskEdits.length})
                  </span>
                  <Badge variant="secondary" className="ml-auto">
                    子タスクとして作成
                  </Badge>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-3">
                  {childTaskEdits.map((edit) => (
                    <div
                      key={edit.stepNumber}
                      className={`rounded-md border p-3 ${edit.include ? "" : "opacity-50"}`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={edit.include}
                          onCheckedChange={(checked) =>
                            updateChildTaskEdit(edit.stepNumber, {
                              include: checked as boolean,
                            })
                          }
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              Step {edit.stepNumber}
                            </Badge>
                            <Input
                              value={edit.title}
                              onChange={(e) =>
                                updateChildTaskEdit(edit.stepNumber, {
                                  title: e.target.value,
                                })
                              }
                              disabled={!edit.include}
                              className="h-8 text-sm"
                            />
                          </div>
                          <Textarea
                            value={edit.description}
                            onChange={(e) =>
                              updateChildTaskEdit(edit.stepNumber, {
                                description: e.target.value,
                              })
                            }
                            disabled={!edit.include}
                            rows={2}
                            className="text-sm"
                            placeholder="説明 (任意)"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* 再生成セクション */}
          <div className="space-y-3 pt-2 border-t">
            <Label className="text-sm font-medium">再生成</Label>
            <div className="flex gap-2 items-start">
              <div className="flex-1 space-y-2">
                <Textarea
                  id="refine-instruction"
                  placeholder="修正指示 (任意): 例: ステップ2をもっと詳しく、エラーハンドリングも追加して"
                  value={userInstruction}
                  onChange={(e) => setUserInstruction(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="shrink-0 space-y-2">
                <Select
                  value={elaborationLevel}
                  onValueChange={(value) => setElaborationLevel(value as ElaborationLevel)}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">簡潔</SelectItem>
                    <SelectItem value="standard">標準</SelectItem>
                    <SelectItem value="detailed">詳細</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={handleRegenerate}
                  className="w-full"
                  title="再生成 (バックグラウンドで実行)"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  再生成
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleDiscard} className="mr-auto">
            <X className="mr-2 h-4 w-4" />
            破棄
          </Button>
          <Button variant="outline" onClick={handleClose}>
            閉じる
          </Button>
          <Button onClick={handleApply} disabled={applying}>
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Check className="mr-2 h-4 w-4" />
            適用する
            <span className="ml-2 text-xs text-muted-foreground">(Cmd+Enter)</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
