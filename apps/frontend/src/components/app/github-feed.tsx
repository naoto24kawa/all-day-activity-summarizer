/**
 * GitHub Feed Component
 *
 * Displays GitHub issues, PRs, and review requests grouped by project
 */

import type { GitHubComment, GitHubItem, Project } from "@repo/types";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Eye,
  FolderKanban,
  Github,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Settings,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfig } from "@/hooks/use-config";
import {
  useGitHubComments,
  useGitHubCommentsUnreadCounts,
  useGitHubItemProjects,
  useGitHubItems,
  useGitHubUnreadCounts,
} from "@/hooks/use-github";
import { formatGitHubDateJST } from "@/lib/date";

interface GitHubFeedProps {
  date: string;
  className?: string;
}

export function GitHubFeed({ date, className }: GitHubFeedProps) {
  const { integrations, loading: configLoading } = useConfig();
  const { items, loading, error, refetch, markAsRead, markAllAsRead } = useGitHubItems();
  const { counts } = useGitHubUnreadCounts(date);
  const { comments, loading: commentsLoading, markAsRead: markCommentAsRead } = useGitHubComments();
  const { counts: commentCounts } = useGitHubCommentsUnreadCounts(date);
  const { projects } = useGitHubItemProjects();

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.github.enabled) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Settings className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">GitHub 連携は無効化されています</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Settings タブの Integrations で有効にできます
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const issues = items.filter((i) => i.itemType === "issue");
  const pullRequests = items.filter((i) => i.itemType === "pull_request" && !i.isReviewRequested);
  const reviewRequests = items.filter((i) => i.itemType === "pull_request" && i.isReviewRequested);

  const totalUnread = counts.total + commentCounts.total;

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          GitHub
          {totalUnread > 0 && (
            <Badge variant="destructive" className="ml-1">
              {totalUnread} unread
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {counts.total > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllAsRead({ date })}>
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 && comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No GitHub activity for this date.</p>
        ) : (
          <Tabs defaultValue="issues" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="issues" className="flex items-center gap-1">
                <CircleDot className="h-3 w-3" />
                Issues
                {counts.issue > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {counts.issue}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="prs" className="flex items-center gap-1">
                <GitPullRequest className="h-3 w-3" />
                PRs
                {counts.pullRequest > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {counts.pullRequest}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="reviews" className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                Reviews
                {counts.reviewRequest > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {counts.reviewRequest}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="comments" className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                Comments
                {commentCounts.total > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {commentCounts.total}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="issues" className="min-h-0 flex-1">
              <ProjectGroupedItemList
                items={issues}
                projects={projects}
                onMarkAsRead={markAsRead}
              />
            </TabsContent>
            <TabsContent value="prs" className="min-h-0 flex-1">
              <ProjectGroupedItemList
                items={pullRequests}
                projects={projects}
                onMarkAsRead={markAsRead}
              />
            </TabsContent>
            <TabsContent value="reviews" className="min-h-0 flex-1">
              <ProjectGroupedItemList
                items={reviewRequests}
                projects={projects}
                onMarkAsRead={markAsRead}
              />
            </TabsContent>
            <TabsContent value="comments" className="min-h-0 flex-1">
              {commentsLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <CommentList comments={comments} onMarkAsRead={markCommentAsRead} />
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

/** グループ化されたアイテム */
interface ProjectGroup {
  projectId: number | null;
  projectName: string;
  items: GitHubItem[];
  unreadCount: number;
}

function ProjectGroupedItemList({
  items,
  projects,
  onMarkAsRead,
}: {
  items: GitHubItem[];
  projects: Project[];
  onMarkAsRead: (id: number) => void;
}) {
  // プロジェクト別にグループ化
  const groups = useMemo((): ProjectGroup[] => {
    const projectMap = new Map<number, Project>();
    for (const p of projects) {
      projectMap.set(p.id, p);
    }

    const groupMap = new Map<number | null, GitHubItem[]>();

    for (const item of items) {
      const key = item.projectId;
      const existing = groupMap.get(key) ?? [];
      existing.push(item);
      groupMap.set(key, existing);
    }

    const result: ProjectGroup[] = [];

    // プロジェクトがあるグループを先に追加
    for (const [projectId, groupItems] of groupMap.entries()) {
      if (projectId !== null) {
        const project = projectMap.get(projectId);
        result.push({
          projectId,
          projectName: project?.name ?? `Project #${projectId}`,
          items: groupItems,
          unreadCount: groupItems.filter((i) => !i.isRead).length,
        });
      }
    }

    // プロジェクト名でソート
    result.sort((a, b) => a.projectName.localeCompare(b.projectName));

    // 未分類を最後に追加
    const unassigned = groupMap.get(null);
    if (unassigned && unassigned.length > 0) {
      result.push({
        projectId: null,
        projectName: "未分類",
        items: unassigned,
        unreadCount: unassigned.filter((i) => !i.isRead).length,
      });
    }

    return result;
  }, [items, projects]);

  // 開閉状態を管理
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    // デフォルトで全て開く
    const initial = new Set<string>();
    for (const g of groups) {
      initial.add(String(g.projectId));
    }
    return initial;
  });

  const toggleGroup = (projectId: number | null) => {
    setOpenGroups((prev) => {
      const key = String(projectId);
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No items.</p>;
  }

  // グループが1つだけ、かつ全て未分類の場合はグループ化せずに表示
  if (groups.length === 1 && groups[0].projectId === null) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="space-y-3">
          {items.map((item) => (
            <GitHubItemCard key={item.id} item={item} onMarkAsRead={onMarkAsRead} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {groups.map((group) => (
          <ProjectCollapsible
            key={String(group.projectId)}
            group={group}
            isOpen={openGroups.has(String(group.projectId))}
            onToggle={() => toggleGroup(group.projectId)}
            onMarkAsRead={onMarkAsRead}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectCollapsible({
  group,
  isOpen,
  onToggle,
  onMarkAsRead,
}: {
  group: ProjectGroup;
  isOpen: boolean;
  onToggle: () => void;
  onMarkAsRead: (id: number) => void;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/50">
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <FolderKanban className="h-4 w-4 text-indigo-500" />
          <span className="truncate text-sm font-medium">{group.projectName}</span>
          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
            {group.items.length}
          </Badge>
          {group.unreadCount > 0 && (
            <Badge variant="destructive" className="h-5 px-1.5 text-xs">
              {group.unreadCount} unread
            </Badge>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 pl-6">
          {group.items.map((item) => (
            <GitHubItemCard key={item.id} item={item} onMarkAsRead={onMarkAsRead} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GitHubItemCard({
  item,
  onMarkAsRead,
}: {
  item: GitHubItem;
  onMarkAsRead: (id: number) => void;
}) {
  const getStateIcon = () => {
    if (item.state === "merged") {
      return <GitMerge className="h-4 w-4 text-purple-500" />;
    }
    if (item.state === "closed") {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
    if (item.itemType === "pull_request") {
      return <GitPullRequest className="h-4 w-4 text-green-500" />;
    }
    return <CircleDot className="h-4 w-4 text-green-500" />;
  };

  const labels = item.labels ? (JSON.parse(item.labels) as string[]) : [];

  return (
    <div
      className={`rounded-md border p-3 ${item.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {getStateIcon()}
          <span className="text-xs font-medium text-muted-foreground">
            {item.repoOwner}/{item.repoName}#{item.number}
          </span>
          {item.githubUpdatedAt && (
            <span className="text-xs text-muted-foreground">
              {formatGitHubDateJST(item.githubUpdatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {item.url && (
            <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          {!item.isRead && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onMarkAsRead(item.id)}
              title="Mark as read"
            >
              <Check className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="mb-2 text-sm font-medium">{item.title}</p>
      <div className="flex flex-wrap items-center gap-1">
        {item.authorLogin && (
          <Badge variant="secondary" className="text-xs">
            @{item.authorLogin}
          </Badge>
        )}
        {item.isDraft && (
          <Badge variant="outline" className="text-xs">
            Draft
          </Badge>
        )}
        {item.reviewDecision && (
          <Badge
            variant={
              item.reviewDecision === "APPROVED"
                ? "default"
                : item.reviewDecision === "CHANGES_REQUESTED"
                  ? "destructive"
                  : "outline"
            }
            className="text-xs"
          >
            {item.reviewDecision.replace(/_/g, " ").toLowerCase()}
          </Badge>
        )}
        {labels.slice(0, 3).map((label) => (
          <Badge key={label} variant="outline" className="text-xs">
            {label}
          </Badge>
        ))}
        {labels.length > 3 && (
          <Badge variant="outline" className="text-xs">
            +{labels.length - 3}
          </Badge>
        )}
      </div>
    </div>
  );
}

function CommentList({
  comments,
  onMarkAsRead,
}: {
  comments: GitHubComment[];
  onMarkAsRead: (id: number) => void;
}) {
  if (comments.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No comments.</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3">
        {comments.map((comment) => (
          <GitHubCommentCard key={comment.id} comment={comment} onMarkAsRead={onMarkAsRead} />
        ))}
      </div>
    </div>
  );
}

function GitHubCommentCard({
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

  return (
    <div
      className={`rounded-md border p-3 ${comment.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {comment.repoOwner}/{comment.repoName}#{comment.itemNumber}
          </span>
          <Badge variant="outline" className="text-xs">
            {getTypeLabel()}
          </Badge>
          {comment.githubCreatedAt && (
            <span className="text-xs text-muted-foreground">
              {formatGitHubDateJST(comment.githubCreatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {comment.url && (
            <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
              <a href={comment.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          {!comment.isRead && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onMarkAsRead(comment.id)}
              title="Mark as read"
            >
              <Check className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {comment.authorLogin && (
        <Badge variant="secondary" className="mb-2 text-xs">
          @{comment.authorLogin}
        </Badge>
      )}
      <p className="line-clamp-3 whitespace-pre-wrap text-sm">{comment.body}</p>
    </div>
  );
}
