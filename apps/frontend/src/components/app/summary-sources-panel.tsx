import type {
  SourceClaudeSession,
  SourceLearning,
  SourceMemo,
  SourceSegment,
  SourceTask,
  SummarySourceMetadata,
} from "@repo/types";
import {
  BookOpen,
  CheckSquare,
  Code,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  MessageCircle,
  MessageSquare,
  Mic,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatTimeJST } from "@/lib/date";
import { SourceDetailDialog } from "./source-detail-dialog";

type SourceDetailType =
  | { type: "segment"; data: SourceSegment }
  | { type: "memo"; data: SourceMemo }
  | { type: "claude"; data: SourceClaudeSession }
  | { type: "task"; data: SourceTask }
  | { type: "learning"; data: SourceLearning };

interface SummarySourcesPanelProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  sources: SummarySourceMetadata | null;
}

export function SummarySourcesPanel({
  open,
  onClose,
  loading,
  error,
  sources,
}: SummarySourcesPanelProps) {
  const [selectedDetail, setSelectedDetail] = useState<SourceDetailType | null>(null);

  const handleDetailClose = () => {
    setSelectedDetail(null);
  };

  const totalCount = sources
    ? sources.segments.length +
      sources.memos.length +
      sources.slackMessages.length +
      sources.claudeSessions.length +
      sources.tasks.length +
      sources.learnings.length +
      sources.githubItems.length +
      sources.githubComments.length
    : 0;

  return (
    <>
      <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <SheetContent className="w-[400px] overflow-y-auto sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>ソース</SheetTitle>
            <SheetDescription>
              このサマリの元となったデータ {totalCount > 0 && `(${totalCount}件)`}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : !sources || totalCount === 0 ? (
              <p className="text-sm text-muted-foreground">ソースデータがありません</p>
            ) : (
              <>
                {/* 音声セグメント */}
                {sources.segments.length > 0 && (
                  <SourceSection
                    title="音声"
                    icon={<Mic className="h-4 w-4" />}
                    count={sources.segments.length}
                  >
                    {sources.segments.map((segment) => (
                      <SourceItem
                        key={segment.id}
                        onClick={() => setSelectedDetail({ type: "segment", data: segment })}
                      >
                        <span className="text-xs text-muted-foreground">
                          {formatTimeJST(segment.startTime)}
                        </span>
                        {segment.speaker && (
                          <Badge variant="outline" className="text-xs">
                            {segment.speaker}
                          </Badge>
                        )}
                        <span className="line-clamp-1 text-sm">
                          {segment.transcription.slice(0, 50)}
                          {segment.transcription.length > 50 ? "..." : ""}
                        </span>
                      </SourceItem>
                    ))}
                  </SourceSection>
                )}

                {/* メモ */}
                {sources.memos.length > 0 && (
                  <SourceSection
                    title="メモ"
                    icon={<FileText className="h-4 w-4" />}
                    count={sources.memos.length}
                  >
                    {sources.memos.map((memo) => (
                      <SourceItem
                        key={memo.id}
                        onClick={() => setSelectedDetail({ type: "memo", data: memo })}
                      >
                        <span className="text-xs text-muted-foreground">
                          {formatTimeJST(memo.createdAt)}
                        </span>
                        <span className="line-clamp-1 text-sm">
                          {memo.content.slice(0, 50)}
                          {memo.content.length > 50 ? "..." : ""}
                        </span>
                      </SourceItem>
                    ))}
                  </SourceSection>
                )}

                {/* Slack */}
                {sources.slackMessages.length > 0 && (
                  <SourceSection
                    title="Slack"
                    icon={<MessageSquare className="h-4 w-4" />}
                    count={sources.slackMessages.length}
                  >
                    {sources.slackMessages.map((msg) => (
                      <SourceLinkItem
                        key={msg.id}
                        href={msg.permalink}
                        label={
                          <>
                            <span className="text-xs text-muted-foreground">
                              #{msg.channelName || "unknown"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {msg.userName || ""}
                            </span>
                            <span className="line-clamp-1 text-sm">
                              {msg.text.slice(0, 40)}
                              {msg.text.length > 40 ? "..." : ""}
                            </span>
                          </>
                        }
                      />
                    ))}
                  </SourceSection>
                )}

                {/* Claude Code */}
                {sources.claudeSessions.length > 0 && (
                  <SourceSection
                    title="Claude Code"
                    icon={<Code className="h-4 w-4" />}
                    count={sources.claudeSessions.length}
                  >
                    {sources.claudeSessions.map((session) => (
                      <SourceItem
                        key={session.id}
                        onClick={() => setSelectedDetail({ type: "claude", data: session })}
                      >
                        <span className="text-xs text-muted-foreground">
                          {session.startTime ? formatTimeJST(session.startTime) : ""}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {session.projectName || "Unknown"}
                        </Badge>
                        <span className="line-clamp-1 text-sm">
                          {session.summary?.slice(0, 40) || "セッション"}
                          {(session.summary?.length ?? 0) > 40 ? "..." : ""}
                        </span>
                      </SourceItem>
                    ))}
                  </SourceSection>
                )}

                {/* タスク */}
                {sources.tasks.length > 0 && (
                  <SourceSection
                    title="タスク"
                    icon={<CheckSquare className="h-4 w-4" />}
                    count={sources.tasks.length}
                  >
                    {sources.tasks.map((task) =>
                      task.githubIssueUrl ? (
                        <SourceLinkItem
                          key={task.id}
                          href={task.githubIssueUrl}
                          label={
                            <>
                              <Badge
                                variant={task.status === "completed" ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {task.status}
                              </Badge>
                              <span className="line-clamp-1 text-sm">{task.title}</span>
                            </>
                          }
                        />
                      ) : (
                        <SourceItem
                          key={task.id}
                          onClick={() => setSelectedDetail({ type: "task", data: task })}
                        >
                          <Badge
                            variant={task.status === "completed" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {task.status}
                          </Badge>
                          <span className="line-clamp-1 text-sm">{task.title}</span>
                        </SourceItem>
                      ),
                    )}
                  </SourceSection>
                )}

                {/* 学び */}
                {sources.learnings.length > 0 && (
                  <SourceSection
                    title="学び"
                    icon={<BookOpen className="h-4 w-4" />}
                    count={sources.learnings.length}
                  >
                    {sources.learnings.map((learning) => (
                      <SourceItem
                        key={learning.id}
                        onClick={() => setSelectedDetail({ type: "learning", data: learning })}
                      >
                        <Badge variant="outline" className="text-xs">
                          {learning.sourceType}
                        </Badge>
                        <span className="line-clamp-1 text-sm">
                          {learning.content.slice(0, 50)}
                          {learning.content.length > 50 ? "..." : ""}
                        </span>
                      </SourceItem>
                    ))}
                  </SourceSection>
                )}

                {/* GitHub Items */}
                {sources.githubItems.length > 0 && (
                  <SourceSection
                    title="GitHub (Issue/PR)"
                    icon={<GitBranch className="h-4 w-4" />}
                    count={sources.githubItems.length}
                  >
                    {sources.githubItems.map((item) => (
                      <SourceLinkItem
                        key={item.id}
                        href={item.url}
                        label={
                          <>
                            <Badge variant="outline" className="text-xs">
                              {item.itemType === "issue" ? "Issue" : "PR"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {item.repoOwner}/{item.repoName}#{item.number}
                            </span>
                            <span className="line-clamp-1 text-sm">{item.title}</span>
                          </>
                        }
                      />
                    ))}
                  </SourceSection>
                )}

                {/* GitHub Comments */}
                {sources.githubComments.length > 0 && (
                  <SourceSection
                    title="GitHub (コメント)"
                    icon={<MessageCircle className="h-4 w-4" />}
                    count={sources.githubComments.length}
                  >
                    {sources.githubComments.map((comment) => (
                      <SourceLinkItem
                        key={comment.id}
                        href={comment.url}
                        label={
                          <>
                            <Badge variant="outline" className="text-xs">
                              {comment.commentType === "review"
                                ? "レビュー"
                                : comment.commentType === "review_comment"
                                  ? "レビューコメント"
                                  : "コメント"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {comment.authorLogin || "unknown"}
                            </span>
                            <span className="line-clamp-1 text-sm">
                              {comment.body.slice(0, 40)}
                              {comment.body.length > 40 ? "..." : ""}
                            </span>
                          </>
                        }
                      />
                    ))}
                  </SourceSection>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <SourceDetailDialog
        open={!!selectedDetail}
        onClose={handleDetailClose}
        detail={selectedDetail}
      />
    </>
  );
}

interface SourceSectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}

function SourceSection({ title, icon, count, children }: SourceSectionProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

interface SourceItemProps {
  children: React.ReactNode;
  onClick: () => void;
}

function SourceItem({ children, onClick }: SourceItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
    >
      {children}
    </button>
  );
}

interface SourceLinkItemProps {
  href: string | null;
  label: React.ReactNode;
}

function SourceLinkItem({ href, label }: SourceLinkItemProps) {
  if (!href) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground">
        {label}
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
    >
      {label}
      <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
    </a>
  );
}
