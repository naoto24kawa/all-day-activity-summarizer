/**
 * Task Elaborate Dialog
 *
 * タスクを AI で詳細化するダイアログ
 * - 入力フェーズ: 追加指示の入力 (音声入力対応)
 * - 処理中フェーズ: AI 処理中の表示
 * - プレビューフェーズ: 結果のプレビュー、編集、修正依頼
 */

import type { ElaborateTaskResponse, Project, Task } from "@repo/types";
import { AlertCircle, Loader2, Mic, MicOff, RefreshCw, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

type DialogPhase = "input" | "processing" | "preview";

interface TaskElaborateDialogProps {
  open: boolean;
  task: Task;
  project: Project | null;
  onElaborate: (
    taskId: number,
    request?: {
      userInstruction?: string;
      currentElaboration?: string;
      revisionInstruction?: string;
    },
  ) => Promise<ElaborateTaskResponse>;
  onApply: (taskId: number, description: string) => Promise<void>;
  onClose: () => void;
}

export function TaskElaborateDialog({
  open,
  task,
  project,
  onElaborate,
  onApply,
  onClose,
}: TaskElaborateDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>("input");
  const [userInstruction, setUserInstruction] = useState("");
  const [elaboration, setElaboration] = useState("");
  const [referencedFiles, setReferencedFiles] = useState<string[]>([]);
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // 音声認識 (入力フェーズ用)
  const {
    listening: inputListening,
    startListening: startInputListening,
    stopListening: stopInputListening,
    isSupported: speechSupported,
  } = useSpeechRecognition({
    onTranscriptChange: (transcript) => setUserInstruction(transcript),
  });

  // 音声認識 (修正依頼用)
  const {
    listening: revisionListening,
    startListening: startRevisionListening,
    stopListening: stopRevisionListening,
  } = useSpeechRecognition({
    onTranscriptChange: (transcript) => setRevisionInstruction(transcript),
  });

  // ダイアログが閉じられたらリセット
  useEffect(() => {
    if (!open) {
      setPhase("input");
      setUserInstruction("");
      setElaboration("");
      setReferencedFiles([]);
      setRevisionInstruction("");
      setError(null);
    }
  }, [open]);

  // 詳細化を実行
  const handleElaborate = useCallback(async () => {
    // 音声入力中なら停止
    if (inputListening) {
      stopInputListening();
    }

    setPhase("processing");
    setError(null);

    try {
      const result = await onElaborate(task.id, {
        userInstruction: userInstruction.trim() || undefined,
      });

      setElaboration(result.elaboration);
      setReferencedFiles(result.referencedFiles ?? []);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "詳細化に失敗しました");
      setPhase("input");
    }
  }, [task.id, userInstruction, inputListening, stopInputListening, onElaborate]);

  // 修正を依頼
  const handleRevision = useCallback(async () => {
    if (!revisionInstruction.trim()) return;

    // 音声入力中なら停止
    if (revisionListening) {
      stopRevisionListening();
    }

    setPhase("processing");
    setError(null);

    try {
      const result = await onElaborate(task.id, {
        currentElaboration: elaboration,
        revisionInstruction: revisionInstruction.trim(),
      });

      setElaboration(result.elaboration);
      setReferencedFiles(result.referencedFiles ?? []);
      setRevisionInstruction("");
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "修正に失敗しました");
      setPhase("preview");
    }
  }, [
    task.id,
    elaboration,
    revisionInstruction,
    revisionListening,
    stopRevisionListening,
    onElaborate,
  ]);

  // 適用
  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      await onApply(task.id, elaboration);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "適用に失敗しました");
    } finally {
      setApplying(false);
    }
  }, [task.id, elaboration, onApply, onClose]);

  // Cmd+Enter で実行
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (phase === "input") {
          handleElaborate();
        } else if (phase === "preview" && !applying) {
          handleApply();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, phase, applying, handleElaborate, handleApply]);

  const handleClose = () => {
    // 音声入力中なら停止
    if (inputListening) stopInputListening();
    if (revisionListening) stopRevisionListening();
    onClose();
  };

  // 入力フェーズ
  if (phase === "input") {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-purple-500" />
              タスクを詳細化
            </DialogTitle>
            <DialogDescription>AI がコードベースを確認してタスクを詳細化します</DialogDescription>
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
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // プレビューフェーズ
  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>詳細化結果のプレビュー</DialogTitle>
          <DialogDescription>結果を確認・編集してから適用してください</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="elaboration">詳細化された説明</Label>
            <Textarea
              id="elaboration"
              value={elaboration}
              onChange={(e) => setElaboration(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>

          {referencedFiles.length > 0 && (
            <div>
              <Label className="text-sm font-medium">参照ファイル</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {referencedFiles.slice(0, 5).join(", ")}
                {referencedFiles.length > 5 && ` 他 ${referencedFiles.length - 5} 件`}
              </p>
            </div>
          )}

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="revision-instruction">修正を依頼 (任意)</Label>
            <div className="relative">
              <Textarea
                id="revision-instruction"
                placeholder="例: 実装手順をもっと詳しく"
                value={revisionInstruction}
                onChange={(e) => setRevisionInstruction(e.target.value)}
                rows={2}
                className="pr-10"
              />
              {speechSupported && (
                <Button
                  type="button"
                  variant={revisionListening ? "destructive" : "ghost"}
                  size="icon"
                  className="absolute right-2 bottom-2 h-8 w-8"
                  onClick={() =>
                    revisionListening
                      ? stopRevisionListening()
                      : startRevisionListening(revisionInstruction)
                  }
                  title={revisionListening ? "音声入力を停止" : "音声入力"}
                >
                  {revisionListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevision}
              disabled={!revisionInstruction.trim()}
            >
              <RefreshCw className="mr-2 h-3 w-3" />
              再生成
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            キャンセル
          </Button>
          <Button onClick={handleApply} disabled={applying || !elaboration.trim()}>
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            適用する
            <span className="ml-2 text-xs text-muted-foreground">(Cmd+Enter)</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
