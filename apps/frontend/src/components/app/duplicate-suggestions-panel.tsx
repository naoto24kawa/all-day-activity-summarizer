/**
 * Duplicate Suggestions Panel Component
 *
 * 重複タスク候補の表示・統合操作
 */

import type { DuplicateTaskPair } from "@repo/types";
import { AlertTriangle, GitMerge, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";

interface DuplicateSuggestionsPanelProps {
  duplicates: DuplicateTaskPair[];
  onMerge: (pair: DuplicateTaskPair, title: string, description: string | null) => Promise<void>;
  onDismiss: (pair: DuplicateTaskPair) => void;
}

export function DuplicateSuggestionsPanel({
  duplicates,
  onMerge,
  onDismiss,
}: DuplicateSuggestionsPanelProps) {
  if (duplicates.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" />
        重複タスク候補 ({duplicates.length} 件)
      </div>
      <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
        以下のタスクは重複している可能性があります。統合するとマージタスクが作成され、承認後に統合が実行されます。
      </p>
      <div className="space-y-2">
        {duplicates.map((dup) => (
          <DuplicateSuggestionItem
            key={`${dup.taskAId}-${dup.taskBId}`}
            pair={dup}
            onMerge={onMerge}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}

interface DuplicateSuggestionItemProps {
  pair: DuplicateTaskPair;
  onMerge: (pair: DuplicateTaskPair, title: string, description: string | null) => Promise<void>;
  onDismiss: (pair: DuplicateTaskPair) => void;
}

function DuplicateSuggestionItem({ pair, onMerge, onDismiss }: DuplicateSuggestionItemProps) {
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeTitle, setMergeTitle] = useState(pair.mergedTitle);
  const [mergeDescription, setMergeDescription] = useState(pair.mergedDescription ?? "");
  const [merging, setMerging] = useState(false);

  const handleMerge = async () => {
    setMerging(true);
    try {
      await onMerge(pair, mergeTitle, mergeDescription || null);
      setMergeDialogOpen(false);
    } finally {
      setMerging(false);
    }
  };

  const similarityPercent = Math.round(pair.similarity * 100);

  return (
    <>
      <div className="flex items-center justify-between rounded bg-white p-2 dark:bg-gray-900">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">#{pair.taskAId}</span>
            <span className="text-muted-foreground">{pair.taskATitle}</span>
            <span className="text-muted-foreground">⟷</span>
            <span className="font-medium">#{pair.taskBId}</span>
            <span className="text-muted-foreground">{pair.taskBTitle}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant={similarityPercent >= 90 ? "destructive" : "secondary"}
              className="text-xs"
            >
              {similarityPercent}% 類似
            </Badge>
            <span>{pair.reason}</span>
          </div>
        </div>
        <div className="ml-2 flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMergeTitle(pair.mergedTitle);
              setMergeDescription(pair.mergedDescription ?? "");
              setMergeDialogOpen(true);
            }}
            className="gap-1"
          >
            <GitMerge className="h-3 w-3" />
            統合
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDismiss(pair)}
            className="text-muted-foreground"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>タスクを統合</DialogTitle>
            <DialogDescription>
              以下の2つのタスクを1つに統合します。統合後のタイトルと説明を確認・編集してください。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/50 p-3">
              <div className="mb-2 text-sm font-medium">統合元タスク</div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">#{pair.taskAId}</Badge>
                  <span>{pair.taskATitle}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">#{pair.taskBId}</Badge>
                  <span>{pair.taskBTitle}</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-title">統合後のタイトル</Label>
              <Input
                id="merge-title"
                value={mergeTitle}
                onChange={(e) => setMergeTitle(e.target.value)}
                placeholder="統合後のタスクタイトル"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-description">統合後の説明 (任意)</Label>
              <Textarea
                id="merge-description"
                value={mergeDescription}
                onChange={(e) => setMergeDescription(e.target.value)}
                placeholder="統合後のタスク説明"
                rows={3}
              />
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
              <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                注意
              </div>
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                「統合」ボタンを押すと、マージタスクが「承認待ち」として作成されます。
                マージタスクを承認すると、統合元の2つのタスクは完了扱いになります。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleMerge} disabled={!mergeTitle.trim() || merging}>
              {merging ? (
                <>処理中...</>
              ) : (
                <>
                  <GitMerge className="mr-1 h-4 w-4" />
                  統合タスクを作成
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
