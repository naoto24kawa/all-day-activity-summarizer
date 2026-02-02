import type {
  SourceClaudeSession,
  SourceLearning,
  SourceMemo,
  SourceSegment,
  SourceTask,
} from "@repo/types";
import { ExternalLink } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTimeJST } from "@/lib/date";

type SourceDetailType =
  | { type: "segment"; data: SourceSegment }
  | { type: "memo"; data: SourceMemo }
  | { type: "claude"; data: SourceClaudeSession }
  | { type: "task"; data: SourceTask }
  | { type: "learning"; data: SourceLearning };

interface SourceDetailDialogProps {
  open: boolean;
  onClose: () => void;
  detail: SourceDetailType | null;
}

export function SourceDetailDialog({ open, onClose, detail }: SourceDetailDialogProps) {
  if (!detail) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            {getDialogTitle(detail)}
          </DialogTitle>
          <DialogDescription>{getDialogDescription(detail)}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <SourceDetailContent detail={detail} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getDialogTitle(detail: SourceDetailType): string {
  switch (detail.type) {
    case "segment":
      return "音声";
    case "memo":
      return "メモ";
    case "claude":
      return "Claude Code セッション";
    case "task":
      return "タスク";
    case "learning":
      return "学び";
  }
}

function getDialogDescription(detail: SourceDetailType): string {
  switch (detail.type) {
    case "segment":
      return `${formatTimeJST(detail.data.startTime)}${detail.data.speaker ? ` - ${detail.data.speaker}` : ""}`;
    case "memo":
      return formatTimeJST(detail.data.createdAt);
    case "claude":
      return `${detail.data.projectName || "Unknown"} - ${detail.data.startTime ? formatTimeJST(detail.data.startTime) : ""}`;
    case "task":
      return `ステータス: ${detail.data.status}`;
    case "learning":
      return `ソース: ${detail.data.sourceType}`;
  }
}

function SourceDetailContent({ detail }: { detail: SourceDetailType }) {
  switch (detail.type) {
    case "segment":
      return (
        <div className="space-y-4">
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">文字起こし</h4>
            <p className="whitespace-pre-wrap text-sm">{detail.data.transcription}</p>
          </div>
        </div>
      );

    case "memo":
      return (
        <div className="space-y-4">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <Markdown remarkPlugins={[remarkGfm]}>{detail.data.content}</Markdown>
          </div>
        </div>
      );

    case "claude":
      return (
        <div className="space-y-4">
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">プロジェクト</h4>
            <p className="text-sm">{detail.data.projectName || "Unknown"}</p>
          </div>
          {detail.data.summary && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-muted-foreground">サマリ</h4>
              <p className="whitespace-pre-wrap text-sm">{detail.data.summary}</p>
            </div>
          )}
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">セッション ID</h4>
            <p className="font-mono text-xs text-muted-foreground">{detail.data.sessionId}</p>
          </div>
        </div>
      );

    case "task":
      return (
        <div className="space-y-4">
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">タイトル</h4>
            <p className="text-sm">{detail.data.title}</p>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">ステータス</h4>
            <p className="text-sm">{detail.data.status}</p>
          </div>
          {detail.data.githubIssueUrl && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-muted-foreground">GitHub Issue</h4>
              <a
                href={detail.data.githubIssueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {detail.data.githubIssueUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      );

    case "learning":
      return (
        <div className="space-y-4">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <Markdown remarkPlugins={[remarkGfm]}>{detail.data.content}</Markdown>
          </div>
        </div>
      );
  }
}
