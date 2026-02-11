/**
 * GitHub Feed Component
 *
 * Displays GitHub issues, PRs, and review requests grouped by repository
 * Comments are shown under their respective Issue/PR
 */

import type { GitHubComment, GitHubItem, Project } from "@repo/types";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Eye,
  FolderGit2,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  Settings,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SegmentedTabContent, SegmentedTabs } from "@/components/ui/segmented-tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { useGitHubComments, useGitHubItems } from "@/hooks/use-github";
import { useProjects } from "@/hooks/use-projects";
import { postAdasApi } from "@/lib/adas-api";
import { formatGitHubDateJST } from "@/lib/date";

interface GitHubFeedProps {
  className?: string;
}

export function GitHubFeed({ className }: GitHubFeedProps) {
  const { integrations, loading: configLoading } = useConfig();
  const {
    items,
    totalCount: itemsTotalCount,
    loading,
    error,
    refetch,
    markAsRead,
  } = useGitHubItems();
  const {
    comments,
    totalCount: commentsTotalCount,
    loading: commentsLoading,
    refetch: refetchComments,
    markAsRead: markCommentAsRead,
  } = useGitHubComments();

  // プロジェクト管理
  const { projects: allProjects, updateProject } = useProjects(false);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("issues");

  // feeds-refresh (統一更新) と github-refresh (個別) をリッスン
  const handleRefresh = useCallback(() => {
    refetch();
    refetchComments();
  }, [refetch, refetchComments]);

  useEffect(() => {
    window.addEventListener("feeds-refresh", handleRefresh);
    window.addEventListener("github-refresh", handleRefresh);
    return () => {
      window.removeEventListener("feeds-refresh", handleRefresh);
      window.removeEventListener("github-refresh", handleRefresh);
    };
  }, [handleRefresh]);

  // アクティブなプロジェクト一覧 (紐付け先選択用)
  const activeProjects = useMemo(
    () => allProjects.filter((p) => p.isActive && !p.excludedAt),
    [allProjects],
  );

  // repoKey → projectId のマッピングを作成
  const repoToProjectMap = useMemo(() => {
    const map = new Map<string, { projectId: number; projectName: string }>();
    for (const p of allProjects) {
      if (p.githubOwner && p.githubRepo) {
        const key = `${p.githubOwner}/${p.githubRepo}`;
        map.set(key, { projectId: p.id, projectName: p.name });
      }
    }
    return map;
  }, [allProjects]);

  // コメントを Item に紐づけるためのマップを作成
  // キー: `${repoOwner}/${repoName}#${itemNumber}`
  const commentsByItem = useMemo(() => {
    const map = new Map<string, GitHubComment[]>();
    for (const comment of comments) {
      const key = `${comment.repoOwner}/${comment.repoName}#${comment.itemNumber}`;
      const existing = map.get(key) ?? [];
      existing.push(comment);
      map.set(key, existing);
    }
    return map;
  }, [comments]);

  const syncProjects = async () => {
    setSyncing(true);
    try {
      await postAdasApi<{ updated: number }>("/api/github-items/sync-projects", {});
      refetch();
    } catch (err) {
      console.error("Failed to sync projects:", err);
    } finally {
      setSyncing(false);
    }
  };

  // リポジトリ → プロジェクト紐付け変更
  const handleRepoProjectChange = async (
    repoOwner: string,
    repoName: string,
    currentProjectId: number | null,
    newProjectIdStr: string,
  ) => {
    const newProjectId = newProjectIdStr === "none" ? null : Number(newProjectIdStr);

    // 現在のプロジェクトから GitHub 情報をクリア
    if (currentProjectId !== null) {
      await updateProject(currentProjectId, {
        githubOwner: null,
        githubRepo: null,
      });
    }

    // 新しいプロジェクトに GitHub 情報を設定
    if (newProjectId !== null) {
      await updateProject(newProjectId, {
        githubOwner: repoOwner,
        githubRepo: repoName,
      });
    }

    // GitHub Items の projectId を同期
    await syncProjects();
  };

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.github.enabled) {
    return (
      <Card className={className}>
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

  if (loading || commentsLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
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
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const issues = items.filter((i) => i.itemType === "issue");
  const pullRequests = items.filter((i) => i.itemType === "pull_request" && !i.isReviewRequested);
  const reviewRequests = items.filter((i) => i.itemType === "pull_request" && i.isReviewRequested);

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-4">
        {(itemsTotalCount > 0 || commentsTotalCount > 0) && (
          <p className="mb-2 text-xs text-muted-foreground">
            Items:{" "}
            {items.length < itemsTotalCount
              ? `${items.length}/${itemsTotalCount}`
              : itemsTotalCount}
            {commentsTotalCount > 0 && (
              <>
                {" "}
                / Comments:{" "}
                {comments.length < commentsTotalCount
                  ? `${comments.length}/${commentsTotalCount}`
                  : commentsTotalCount}
              </>
            )}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No GitHub activity for this date.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <SegmentedTabs
              tabs={[
                { id: "issues", label: "Issues", icon: CircleDot },
                { id: "prs", label: "PRs", icon: GitPullRequest },
                { id: "reviews", label: "Reviews", icon: Eye },
              ]}
              value={activeTab}
              onValueChange={setActiveTab}
              className="mb-2 shrink-0"
            />
            <SegmentedTabContent value="issues" activeValue={activeTab}>
              <RepoGroupedItemList
                items={issues}
                commentsByItem={commentsByItem}
                repoToProjectMap={repoToProjectMap}
                activeProjects={activeProjects}
                onMarkAsRead={markAsRead}
                onMarkCommentAsRead={markCommentAsRead}
                onProjectChange={handleRepoProjectChange}
                syncing={syncing}
              />
            </SegmentedTabContent>
            <SegmentedTabContent value="prs" activeValue={activeTab}>
              <RepoGroupedItemList
                items={pullRequests}
                commentsByItem={commentsByItem}
                repoToProjectMap={repoToProjectMap}
                activeProjects={activeProjects}
                onMarkAsRead={markAsRead}
                onMarkCommentAsRead={markCommentAsRead}
                onProjectChange={handleRepoProjectChange}
                syncing={syncing}
              />
            </SegmentedTabContent>
            <SegmentedTabContent value="reviews" activeValue={activeTab}>
              <RepoGroupedItemList
                items={reviewRequests}
                commentsByItem={commentsByItem}
                repoToProjectMap={repoToProjectMap}
                activeProjects={activeProjects}
                onMarkAsRead={markAsRead}
                onMarkCommentAsRead={markCommentAsRead}
                onProjectChange={handleRepoProjectChange}
                syncing={syncing}
              />
            </SegmentedTabContent>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** リポジトリ別グループ */
interface RepoGroup {
  repoKey: string;
  repoOwner: string;
  repoName: string;
  projectId: number | null;
  projectName: string | null;
  items: GitHubItem[];
  unreadCount: number;
}

function RepoGroupedItemList({
  items,
  commentsByItem,
  repoToProjectMap,
  activeProjects,
  onMarkAsRead,
  onMarkCommentAsRead,
  onProjectChange,
  syncing,
}: {
  items: GitHubItem[];
  commentsByItem: Map<string, GitHubComment[]>;
  repoToProjectMap: Map<string, { projectId: number; projectName: string }>;
  activeProjects: Project[];
  onMarkAsRead: (id: number) => void;
  onMarkCommentAsRead: (id: number) => void;
  onProjectChange: (
    repoOwner: string,
    repoName: string,
    currentProjectId: number | null,
    newProjectIdStr: string,
  ) => void;
  syncing: boolean;
}) {
  // リポジトリ別にグループ化
  const groups = useMemo((): RepoGroup[] => {
    const groupMap = new Map<string, GitHubItem[]>();

    for (const item of items) {
      const key = `${item.repoOwner}/${item.repoName}`;
      const existing = groupMap.get(key) ?? [];
      existing.push(item);
      groupMap.set(key, existing);
    }

    const result: RepoGroup[] = [];

    for (const [repoKey, groupItems] of groupMap.entries()) {
      const [repoOwner, repoName] = repoKey.split("/");
      const projectInfo = repoToProjectMap.get(repoKey);
      result.push({
        repoKey,
        repoOwner: repoOwner ?? "",
        repoName: repoName ?? "",
        projectId: projectInfo?.projectId ?? null,
        projectName: projectInfo?.projectName ?? null,
        items: groupItems,
        unreadCount: groupItems.filter((i) => !i.isRead).length,
      });
    }

    // リポジトリ名でソート
    result.sort((a, b) => a.repoKey.localeCompare(b.repoKey));

    return result;
  }, [items, repoToProjectMap]);

  // 開閉状態を管理
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const g of groups) {
      initial.add(g.repoKey);
    }
    return initial;
  });

  const toggleGroup = (repoKey: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(repoKey)) {
        next.delete(repoKey);
      } else {
        next.add(repoKey);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No items.</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {groups.map((group) => (
          <RepoCollapsible
            key={group.repoKey}
            group={group}
            commentsByItem={commentsByItem}
            isOpen={openGroups.has(group.repoKey)}
            onToggle={() => toggleGroup(group.repoKey)}
            activeProjects={activeProjects}
            onMarkAsRead={onMarkAsRead}
            onMarkCommentAsRead={onMarkCommentAsRead}
            onProjectChange={onProjectChange}
            syncing={syncing}
          />
        ))}
      </div>
    </div>
  );
}

function RepoCollapsible({
  group,
  commentsByItem,
  isOpen,
  onToggle,
  activeProjects,
  onMarkAsRead,
  onMarkCommentAsRead,
  onProjectChange,
  syncing,
}: {
  group: RepoGroup;
  commentsByItem: Map<string, GitHubComment[]>;
  isOpen: boolean;
  onToggle: () => void;
  activeProjects: Project[];
  onMarkAsRead: (id: number) => void;
  onMarkCommentAsRead: (id: number) => void;
  onProjectChange: (
    repoOwner: string,
    repoName: string,
    currentProjectId: number | null,
    newProjectIdStr: string,
  ) => void;
  syncing: boolean;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="flex items-center gap-2 rounded-md border p-2 hover:bg-muted/50">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <FolderGit2 className="h-4 w-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{group.repoKey}</span>
          <span className="ml-1 text-xs text-muted-foreground">({group.items.length})</span>
        </CollapsibleTrigger>
        {/* プロジェクト Select */}
        <Select
          value={group.projectId?.toString() ?? "none"}
          onValueChange={(value) =>
            onProjectChange(group.repoOwner, group.repoName, group.projectId, value)
          }
          disabled={syncing}
        >
          <SelectTrigger className="h-7 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">なし</SelectItem>
            {activeProjects.map((project) => (
              <SelectItem key={project.id} value={project.id.toString()}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 pl-6">
          {group.items.map((item) => {
            const key = `${item.repoOwner}/${item.repoName}#${item.number}`;
            const itemComments = commentsByItem.get(key) ?? [];
            return (
              <GitHubItemCard
                key={item.id}
                item={item}
                comments={itemComments}
                onMarkAsRead={onMarkAsRead}
                onMarkCommentAsRead={onMarkCommentAsRead}
              />
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GitHubItemCard({
  item,
  comments,
  onMarkAsRead,
  onMarkCommentAsRead,
}: {
  item: GitHubItem;
  comments: GitHubComment[];
  onMarkAsRead: (id: number) => void;
  onMarkCommentAsRead: (id: number) => void;
}) {
  const [showComments, setShowComments] = useState(false);

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
    <div className="rounded-md border p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {getStateIcon()}
          <span className="text-xs font-medium text-muted-foreground">#{item.number}</span>
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

      {/* コメントセクション */}
      {comments.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <button
            type="button"
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <MessageSquare className="h-3 w-3" />
            {comments.length} comment{comments.length !== 1 ? "s" : ""}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showComments ? "rotate-180" : ""}`}
            />
          </button>
          {showComments && (
            <div className="mt-2 space-y-2">
              {comments.map((comment) => (
                <GitHubCommentCard
                  key={comment.id}
                  comment={comment}
                  onMarkAsRead={onMarkCommentAsRead}
                />
              ))}
            </div>
          )}
        </div>
      )}
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
    <div className="rounded-md border p-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {getTypeLabel()}
          </Badge>
          {comment.authorLogin && (
            <span className="text-muted-foreground">@{comment.authorLogin}</span>
          )}
          {comment.githubCreatedAt && (
            <span className="text-muted-foreground">
              {formatGitHubDateJST(comment.githubCreatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {comment.url && (
            <Button variant="ghost" size="icon" className="h-5 w-5" asChild>
              <a href={comment.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
      <p className="line-clamp-2 whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
}
