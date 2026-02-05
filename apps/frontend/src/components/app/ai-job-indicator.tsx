/**
 * AI Job Indicator
 *
 * ヘッダーに表示する処理中ジョブのインジケーター
 * クリックするとジョブ一覧のポップオーバーを表示
 */

import type { AIJob, AIJobStatus, AIJobType } from "@repo/types";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";

interface AIJobIndicatorProps {
  /** 処理待ちジョブ数 */
  pendingCount: number;
  /** 処理中ジョブ数 */
  processingCount: number;
  /** SSE接続中 */
  isConnected: boolean;
  /** ジョブ一覧 */
  jobs?: AIJob[];
  /** ジョブ一覧を更新 */
  onRefresh?: () => void;
}

/** ジョブタイプの表示名 */
const JOB_TYPE_LABELS: Record<AIJobType, string> = {
  "task-extract-slack": "Slack タスク抽出",
  "task-extract-github": "GitHub タスク抽出",
  "task-extract-github-comment": "GitHub コメント抽出",
  "task-extract-memo": "メモ タスク抽出",
  "task-elaborate": "タスク詳細化",
  "task-check-completion": "タスク完了チェック",
  "task-check-completion-individual": "タスク完了チェック",
  "learning-extract": "学び抽出",
  "learning-explain": "学び詳細説明",
  "vocabulary-extract": "用語抽出",
  "vocabulary-generate-readings": "読み仮名生成",
  "profile-analyze": "プロフィール分析",
  "summarize-times": "時間範囲サマリ",
  "summarize-daily": "日次サマリ",
  "slack-priority": "Slack 優先度判定",
  "claude-chat": "Claude 送信",
};

/** ステータスアイコン */
function StatusIcon({ status }: { status: AIJobStatus }) {
  switch (status) {
    case "pending":
      return <Clock className="size-3 text-muted-foreground" />;
    case "processing":
      return <Loader2 className="size-3 animate-spin text-blue-500" />;
    case "completed":
      return <CheckCircle2 className="size-3 text-green-500" />;
    case "failed":
      return <AlertCircle className="size-3 text-red-500" />;
  }
}

/** 相対時間を計算 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec}秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  return `${Math.floor(diffHour / 24)}日前`;
}

export function AIJobIndicator({
  pendingCount,
  processingCount,
  isConnected,
  jobs = [],
  onRefresh,
}: AIJobIndicatorProps) {
  const totalActive = pendingCount + processingCount;
  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open && onRefresh) {
        onRefresh();
      }
    },
    [onRefresh],
  );

  if (totalActive === 0 && jobs.length === 0) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-auto gap-1.5 px-2 py-1">
          {totalActive > 0 ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              <span className="text-xs font-medium">{totalActive}</span>
            </>
          ) : (
            <CheckCircle2 className="size-3 text-muted-foreground" />
          )}
          {!isConnected && <span className="size-1.5 rounded-full bg-yellow-500" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h4 className="text-sm font-medium">AI ジョブキュー</h4>
          <div className="flex items-center gap-2">
            {!isConnected && <span className="text-xs text-yellow-500">接続中断</span>}
            {onRefresh && (
              <Button variant="ghost" size="sm" className="size-6 p-0" onClick={onRefresh}>
                <RefreshCw className="size-3" />
              </Button>
            )}
          </div>
        </div>

        {/* 統計 */}
        <div className="flex gap-2 border-b px-3 py-2 text-xs">
          {processingCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="size-3 animate-spin" />
              {processingCount}
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Clock className="size-3" />
              {pendingCount}
            </Badge>
          )}
          {totalActive === 0 && (
            <span className="text-muted-foreground">アクティブなジョブなし</span>
          )}
        </div>

        {/* ジョブ一覧 */}
        <ScrollArea className="h-[240px]">
          {jobs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              ジョブがありません
            </div>
          ) : (
            <div className="divide-y">
              {jobs.map((job) => (
                <div key={job.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={job.status} />
                    <span className="flex-1 truncate text-xs font-medium">
                      {JOB_TYPE_LABELS[job.jobType] || job.jobType}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(job.createdAt)}
                    </span>
                  </div>
                  {job.resultSummary && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {job.resultSummary}
                    </p>
                  )}
                  {job.errorMessage && (
                    <p className="mt-1 truncate text-xs text-red-500">{job.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
