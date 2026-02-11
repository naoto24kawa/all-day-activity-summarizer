/**
 * GitHub Feed Component
 *
 * Displays GitHub issues, PRs, and review requests grouped by repository
 * Summary + expand-on-demand pattern: repo list initially, items on expand
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
import {
  type GitHubCommentRepoSummary,
  type GitHubRepoSummary,
  useGitHubComments,
  useGitHubItems,
  useGitHubRepoData,
  useGitHubSummary,
} from "@/hooks/use-github";
import { useProjects } from "@/hooks/use-projects";
import { postAdasApi } from "@/lib/adas-api";
import { formatGitHubDateJST } from "@/lib/date";

interface GitHubFeedProps {
  className?: string;
}

/** マージ済みリポジトリサマリー */
interface MergedRepoSummary {
  repoKey: string;
  repoOwner: string;
  repoName: string;
  issueCount: number;
  pullRequestCount: number;
  reviewRequestCount: number;
  unreadCount: number;
  projectId: number | null;
  commentCount: number;
  commentUnreadCount: number;
}

export function GitHubFeed({ className }: GitHubFeedProps) {
  const { integrations, loading: configLoading } = useConfig();
  // Summary for initial display
  const {
    repositories,
    commentRepositories,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useGitHubSummary();
  // Existing hooks for actions only
  const { markAsRead: markItemAsRead } = useGitHubItems();
  const { markAsRead: markCommentAsRead } = useGitHubComments();

  // プロジェクト管理
  const { projects: allProjects, updateProject } = useProjects(false);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("issues");

  // feeds-refresh / github-refresh をリッスン
  const handleRefresh = useCallback(() => {
    refetchSummary();
  }, [refetchSummary]);

  useEffect(() => {
    window.addEventListener("feeds-refresh", handleRefresh);
    window.addEventListener("github-refresh", handleRefresh);
    return () => {
      window.removeEventListener("feeds-refresh", handleRefresh);
      window.removeEventListener("github-refresh", handleRefresh);
    };
  }, [handleRefresh]);

  // アクティブなプロジェクト一覧
  const activeProjects = useMemo(
    () => allProjects.filter((p) => p.isActive && !p.excludedAt),
    [allProjects],
  );

  // repoKey → projectId のマッピング
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

  // Items + Comments のリポジトリサマリーをマージ
  const mergedRepos = useMemo((): MergedRepoSummary[] => {
    const map = new Map<string, MergedRepoSummary>();

    for (const repo of repositories) {
      const key = `${repo.repoOwner}/${repo.repoName}`;
      map.set(key, {
        repoKey: key,
        repoOwner: repo.repoOwner,
        repoName: repo.repoName,
        issueCount: repo.issueCount,
        pullRequestCount: repo.pullRequestCount,
        reviewRequestCount: repo.reviewRequestCount,
        unreadCount: repo.unreadCount,
        projectId: repo.projectId,
        commentCount: 0,
        commentUnreadCount: 0,
      });
    }

    for (const repo of commentRepositories) {
      const key = `${repo.repoOwner}/${repo.repoName}`;
      const existing = map.get(key);
      if (existing) {
        existing.commentCount = repo.commentCount;
        existing.commentUnreadCount = repo.unreadCount;
      } else {
        map.set(key, {
          repoKey: key,
          repoOwner: repo.repoOwner,
          repoName: repo.repoName,
          issueCount: 0,
          pullRequestCount: 0,
          reviewRequestCount: 0,
          unreadCount: 0,
          projectId: null,
          commentCount: repo.commentCount,
          commentUnreadCount: repo.unreadCount,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.repoKey.localeCompare(b.repoKey));
  }, [repositories, commentRepositories]);

  // タブでリポジトリをフィルター
  const filteredRepos = useMemo(() => {
    switch (activeTab) {
      case "issues":
        return mergedRepos.filter((r) => r.issueCount > 0);
      case "prs":
        return mergedRepos.filter((r) => r.pullRequestCount > 0);
      case "reviews":
        return mergedRepos.filter((r) => r.reviewRequestCount > 0);
      default:
        return mergedRepos;
    }
  }, [mergedRepos, activeTab]);

  const syncProjects = async () => {
    setSyncing(true);
    try {
      await postAdasApi<{ updated: number }>("/api/github-items/sync-projects", {});
      refetchSummary();
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

    if (currentProjectId !== null) {
      await updateProject(currentProjectId, { githubOwner: null, githubRepo: null });
    }

    if (newProjectId !== null) {
      await updateProject(newProjectId, { githubOwner: repoOwner, githubRepo: repoName });
    }

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

  if (summaryLoading) {
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

  if (summaryError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{summaryError}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-4">
        {mergedRepos.length === 0 ? (
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
              <RepoSummaryList
                repos={filteredRepos}
                activeTab="issues"
                repoToProjectMap={repoToProjectMap}
                activeProjects={activeProjects}
                onMarkAsRead={markItemAsRead}
                onMarkCommentAsRead={markCommentAsRead}
                onProjectChange={handleRepoProjectChange}
                syncing={syncing}
              />
            </SegmentedTabContent>
            <SegmentedTabContent value="prs" activeValue={activeTab}>
              <RepoSummaryList
                repos={filteredRepos}
                activeTab="prs"
                repoToProjectMap={repoToProjectMap}
                activeProjects={activeProjects}
                onMarkAsRead={markItemAsRead}
                onMarkCommentAsRead={markCommentAsRead}
                onProjectChange={handleRepoProjectChange}
                syncing={syncing}
              />
            </SegmentedTabContent>
            <SegmentedTabContent value="reviews" activeValue={activeTab}>
              <RepoSummaryList
                repos={filteredRepos}
                activeTab="reviews"
                repoToProjectMap={repoToProjectMap}
                activeProjects={activeProjects}
                onMarkAsRead={markItemAsRead}
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

/** リポジトリ一覧 (summary ベース) */
function RepoSummaryList({
  repos,
  activeTab,
  repoToProjectMap,
  activeProjects,
  onMarkAsRead,
  onMarkCommentAsRead,
  onProjectChange,
  syncing,
}: {
  repos: MergedRepoSummary[];
  activeTab: string;
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

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

  if (repos.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No items.</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {repos.map((repo) => {
          const projectInfo = repoToProjectMap.get(repo.repoKey);
          const itemCount =
            activeTab === "issues"
              ? repo.issueCount
              : activeTab === "prs"
                ? repo.pullRequestCount
                : repo.reviewRequestCount;

          return (
            <RepoCollapsible
              key={repo.repoKey}
              repo={repo}
              itemCount={itemCount}
              projectId={projectInfo?.projectId ?? null}
              isOpen={openGroups.has(repo.repoKey)}
              onToggle={() => toggleGroup(repo.repoKey)}
              activeTab={activeTab}
              activeProjects={activeProjects}
              onMarkAsRead={onMarkAsRead}
              onMarkCommentAsRead={onMarkCommentAsRead}
              onProjectChange={onProjectChange}
              syncing={syncing}
            />
          );
        })}
      </div>
    </div>
  );
}

/** リポジトリ行 (折りたたみ) - 展開時にアイテム取得 */
function RepoCollapsible({
  repo,
  itemCount,
  projectId,
  isOpen,
  onToggle,
  activeTab,
  activeProjects,
  onMarkAsRead,
  onMarkCommentAsRead,
  onProjectChange,
  syncing,
}: {
  repo: MergedRepoSummary;
  itemCount: number;
  projectId: number | null;
  isOpen: boolean;
  onToggle: () => void;
  activeTab: string;
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
          <span className="truncate text-sm font-medium">{repo.repoKey}</span>
          <span className="ml-1 text-xs text-muted-foreground">({itemCount})</span>
          {repo.unreadCount > 0 && (
            <Badge variant="default" className="text-xs">
              {repo.unreadCount}
            </Badge>
          )}
        </CollapsibleTrigger>
        {/* プロジェクト Select */}
        <Select
          value={projectId?.toString() ?? "none"}
          onValueChange={(value) =>
            onProjectChange(repo.repoOwner, repo.repoName, projectId, value)
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
          {isOpen && (
            <RepoExpandedContent
              repoOwner={repo.repoOwner}
              repoName={repo.repoName}
              activeTab={activeTab}
              onMarkAsRead={onMarkAsRead}
              onMarkCommentAsRead={onMarkCommentAsRead}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** リポジトリ展開時のアイテム一覧 (展開時に取得) */
function RepoExpandedContent({
  repoOwner,
  repoName,
  activeTab,
  onMarkAsRead,
  onMarkCommentAsRead,
}: {
  repoOwner: string;
  repoName: string;
  activeTab: string;
  onMarkAsRead: (id: number) => void;
  onMarkCommentAsRead: (id: number) => void;
}) {
  const { items, comments, loading } = useGitHubRepoData(repoOwner, repoName);

  // タブでアイテムをフィルター
  const filteredItems = useMemo(() => {
    switch (activeTab) {
      case "issues":
        return items.filter((i) => i.itemType === "issue");
      case "prs":
        return items.filter((i) => i.itemType === "pull_request" && !i.isReviewRequested);
      case "reviews":
        return items.filter((i) => i.itemType === "pull_request" && i.isReviewRequested);
      default:
        return items;
    }
  }, [items, activeTab]);

  // コメントを Item に紐づけるマップ
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

  if (loading) {
    return (
      <div className="space-y-2">
        {["s1", "s2", "s3"].map((id) => (
          <Skeleton key={id} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (filteredItems.length === 0) {
    return <p className="py-2 text-center text-sm text-muted-foreground">No items.</p>;
  }

  return (
    <>
      {filteredItems.map((item) => {
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
    </>
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
