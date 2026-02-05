/**
 * GitHub Priority Panel Component
 *
 * Displays recent GitHub comments that need attention
 */

import type { GitHubComment } from "@repo/types";
import { Check, ExternalLink, Github, Loader2, MessageSquare, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { useGitHubComments } from "@/hooks/use-github";
import { formatGitHubDateJST } from "@/lib/date";

interface GitHubPriorityPanelProps {
  className?: string;
}

const INITIAL_LIMIT = 15;
const LOAD_MORE_COUNT = 10;

export function GitHubPriorityPanel({ className }: GitHubPriorityPanelProps) {
  const { integrations, loading: configLoading } = useConfig();
  const { comments, loading, error, refetch, markAsRead } = useGitHubComments();
  const [limit, setLimit] = useState(INITIAL_LIMIT);

  // github-refresh イベントをリッスン
  useEffect(() => {
    const handleRefresh = () => refetch();
    window.addEventListener("github-refresh", handleRefresh);
    return () => window.removeEventListener("github-refresh", handleRefresh);
  }, [refetch]);

  // 未読コメントを直近順でソート
  const recentUnreadComments = useMemo(() => {
    return comments
      .filter((c) => !c.isRead)
      .sort((a, b) => {
        const dateA = a.githubCreatedAt ? new Date(a.githubCreatedAt).getTime() : 0;
        const dateB = b.githubCreatedAt ? new Date(b.githubCreatedAt).getTime() : 0;
        return dateB - dateA; // 新しい順
      });
  }, [comments]);

  const displayedComments = recentUnreadComments.slice(0, limit);
  const hasMore = recentUnreadComments.length > limit;

  // 無限スクロール用の sentinel ref
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    if (hasMore) {
      setLimit((prev) => prev + LOAD_MORE_COUNT);
    }
  }, [hasMore]);

  // IntersectionObserver で sentinel が見えたら自動読み込み
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.github.enabled) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-gray-600" />
            Recent Comments
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6">
          <Settings className="mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">GitHub 連携は無効化されています</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-gray-600" />
            Recent Comments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-gray-600" />
            Recent Comments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex flex-col ${className ?? ""}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-gray-600" />
          Recent Comments
          {recentUnreadComments.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              {recentUnreadComments.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
        {recentUnreadComments.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground">
            <Check className="mb-2 h-8 w-8" />
            <p className="text-sm">未読のコメントはありません</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-3">
              {displayedComments.map((comment) => (
                <GitHubCommentItem key={comment.id} comment={comment} onMarkAsRead={markAsRead} />
              ))}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-3 text-xs text-muted-foreground"
                >
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  読み込み中...
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function GitHubCommentItem({
  comment,
  onMarkAsRead,
}: {
  comment: GitHubComment;
  onMarkAsRead: (id: number) => void;
}) {
  const getTypeLabel = () => {
    if (comment.commentType === "review") {
      return comment.reviewState?.toLowerCase().replace(/_/g, " ") || "review";
    }
    return comment.commentType.replace(/_/g, " ");
  };

  const getTypeStyle = () => {
    if (comment.commentType === "review") {
      switch (comment.reviewState) {
        case "APPROVED":
          return "border-l-green-500 bg-green-50/50 dark:bg-green-950/20";
        case "CHANGES_REQUESTED":
          return "border-l-red-500 bg-red-50/50 dark:bg-red-950/20";
        default:
          return "border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20";
      }
    }
    return "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20";
  };

  return (
    <div className={`flex items-start gap-2 rounded-md border border-l-4 p-2 ${getTypeStyle()}`}>
      <Github className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-4 px-1 text-xs">
            {getTypeLabel()}
          </Badge>
          <span className="truncate font-medium">
            {comment.repoOwner}/{comment.repoName}#{comment.itemNumber}
          </span>
          {comment.authorLogin && <span>@{comment.authorLogin}</span>}
          {comment.githubCreatedAt && (
            <span className="opacity-60">{formatGitHubDateJST(comment.githubCreatedAt)}</span>
          )}
        </div>
        <p className="line-clamp-2 text-sm">{comment.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {comment.url && (
          <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
            <a href={comment.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onMarkAsRead(comment.id)}
          title="Mark as read"
        >
          <Check className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
