/**
 * GitHub Repos Panel
 *
 * スキャン済み Git リポジトリ一覧を表示し、プロジェクトとの紐付けを管理
 */

import type { Project } from "@repo/types";
import { ChevronDown, FolderGit2, GitBranch, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/hooks/use-projects";
import { postAdasApi } from "@/lib/adas-api";

interface GitHubReposPanelProps {
  className?: string;
}

interface RepoInfo {
  projectId: number;
  projectName: string;
  owner: string;
  repo: string;
}

interface OwnerGroup {
  owner: string;
  repos: RepoInfo[];
}

export function GitHubReposPanel({ className }: GitHubReposPanelProps) {
  const { projects, loading, scanning, scanGitRepos, updateProject } = useProjects(false);
  const [openOwners, setOpenOwners] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  // GitHub リポジトリ情報を持つプロジェクトを抽出してグループ化
  const { ownerGroups, activeProjects } = useMemo(() => {
    const reposWithGitHub = projects.filter((p) => p.githubOwner && p.githubRepo && !p.excludedAt);

    // オーナーでグループ化
    const grouped = reposWithGitHub.reduce<Record<string, RepoInfo[]>>((acc, project) => {
      const owner = project.githubOwner!;
      if (!acc[owner]) {
        acc[owner] = [];
      }
      acc[owner].push({
        projectId: project.id,
        projectName: project.name,
        owner,
        repo: project.githubRepo!,
      });
      return acc;
    }, {});

    // オーナー名でソート、リポジトリ名でソート
    const sortedGroups: OwnerGroup[] = Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b))
      .map((owner) => ({
        owner,
        repos: (grouped[owner] ?? []).sort((a, b) => a.repo.localeCompare(b.repo)),
      }));

    // アクティブなプロジェクト一覧 (紐付け先選択用)
    const active = projects.filter((p) => p.isActive && !p.excludedAt);

    return { ownerGroups: sortedGroups, activeProjects: active };
  }, [projects]);

  const toggleOwner = (owner: string) => {
    setOpenOwners((prev) => {
      const next = new Set(prev);
      if (next.has(owner)) {
        next.delete(owner);
      } else {
        next.add(owner);
      }
      return next;
    });
  };

  const handleScan = async () => {
    const result = await scanGitRepos();
    if (result) {
      // 新しくスキャンされたオーナーを開く
      const newOwners = new Set<string>();
      result.repos.forEach((repo) => {
        if (repo.githubOwner) {
          newOwners.add(repo.githubOwner);
        }
      });
      setOpenOwners((prev) => new Set([...prev, ...newOwners]));
    }
  };

  const handleProjectChange = async (repoProjectId: number, targetProjectIdStr: string) => {
    // 「なし」の場合は GitHub 情報をクリア
    if (targetProjectIdStr === "none") {
      await updateProject(repoProjectId, {
        githubOwner: null,
        githubRepo: null,
      });
    } else {
      // 別のプロジェクトに紐付ける場合
      // 現在のリポジトリ情報を取得
      const currentProject = projects.find((p) => p.id === repoProjectId);
      if (!currentProject?.githubOwner || !currentProject?.githubRepo) return;

      const targetProjectId = Number(targetProjectIdStr);
      if (targetProjectId === repoProjectId) return; // 同じプロジェクトなら何もしない

      // 元のプロジェクトから GitHub 情報をクリア
      await updateProject(repoProjectId, {
        githubOwner: null,
        githubRepo: null,
      });

      // 対象プロジェクトに GitHub 情報を設定
      await updateProject(targetProjectId, {
        githubOwner: currentProject.githubOwner,
        githubRepo: currentProject.githubRepo,
      });
    }

    // GitHub Items の projectId を同期
    await syncProjects();
  };

  const syncProjects = async () => {
    setSyncing(true);
    try {
      await postAdasApi<{ updated: number }>("/api/github-items/sync-projects", {});
    } catch (err) {
      console.error("Failed to sync projects:", err);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            GitHub Repositories
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          GitHub Repositories
          {ownerGroups.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {ownerGroups.reduce((sum, g) => sum + g.repos.length, 0)} repos
            </Badge>
          )}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning || syncing}>
          <RefreshCw className={`mr-1 h-3 w-3 ${scanning ? "animate-spin" : ""}`} />
          Scan
        </Button>
      </CardHeader>
      <CardContent>
        {ownerGroups.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            <p>GitHub リポジトリが見つかりません</p>
            <p className="mt-1 text-xs">「Scan」ボタンで Git リポジトリをスキャンできます</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ownerGroups.map((group) => (
              <OwnerGroupItem
                key={group.owner}
                group={group}
                isOpen={openOwners.has(group.owner)}
                onToggle={() => toggleOwner(group.owner)}
                activeProjects={activeProjects}
                onProjectChange={handleProjectChange}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface OwnerGroupItemProps {
  group: OwnerGroup;
  isOpen: boolean;
  onToggle: () => void;
  activeProjects: Project[];
  onProjectChange: (repoProjectId: number, targetProjectIdStr: string) => void;
}

function OwnerGroupItem({
  group,
  isOpen,
  onToggle,
  activeProjects,
  onProjectChange,
}: OwnerGroupItemProps) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-3 hover:bg-muted/50">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{group.owner}</span>
          <Badge variant="secondary" className="text-xs">
            {group.repos.length}
          </Badge>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 pl-4">
        {group.repos.map((repo) => (
          <RepoItem
            key={repo.projectId}
            repo={repo}
            activeProjects={activeProjects}
            onProjectChange={onProjectChange}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface RepoItemProps {
  repo: RepoInfo;
  activeProjects: Project[];
  onProjectChange: (repoProjectId: number, targetProjectIdStr: string) => void;
}

function RepoItem({ repo, activeProjects, onProjectChange }: RepoItemProps) {
  return (
    <div className="flex items-center justify-between rounded-md border p-2 hover:bg-muted/30">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3 w-3 text-muted-foreground" />
        <span className="text-sm">{repo.repo}</span>
      </div>
      <Select
        value={repo.projectId.toString()}
        onValueChange={(value) => onProjectChange(repo.projectId, value)}
      >
        <SelectTrigger className="h-7 w-[150px] text-xs">
          <SelectValue placeholder="プロジェクト" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">紐付けなし</SelectItem>
          {activeProjects.map((project) => (
            <SelectItem key={project.id} value={project.id.toString()}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
