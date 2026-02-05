/**
 * Projects Panel
 *
 * プロジェクト管理パネル
 */

import type { Project, ProjectStats, ScanGitReposResponse } from "@repo/types";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  FolderKanban,
  Github,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useProjects, useProjectsConfig } from "@/hooks/use-projects";
import { cn } from "@/lib/utils";

interface ProjectsPanelProps {
  className?: string;
  selectedProjectId?: number | null;
  onSelectProject?: (project: Project | null) => void;
}

export function ProjectsPanel({
  className,
  selectedProjectId,
  onSelectProject,
}: ProjectsPanelProps) {
  const {
    projects,
    loading,
    error,
    autoDetecting,
    scanning,
    createProject,
    updateProject,
    deleteProject,
    fetchProjectStats,
    autoDetect,
    scanGitRepos,
    excludeProject,
    restoreProject,
    fetchExcludedProjects,
  } = useProjects(false); // 全プロジェクトを取得

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [autoDetectResult, setAutoDetectResult] = useState<{
    detected: number;
    created: number;
  } | null>(null);
  const [scanResult, setScanResult] = useState<ScanGitReposResponse | null>(null);

  // 除外済みプロジェクト
  const [excludedProjects, setExcludedProjects] = useState<Project[]>([]);
  const [excludedOpen, setExcludedOpen] = useState(false);

  // プロジェクト別統計を保持
  const [projectStats, setProjectStats] = useState<Record<number, ProjectStats>>({});

  // 統計を取得
  useEffect(() => {
    const fetchStats = async () => {
      const stats: Record<number, ProjectStats> = {};
      for (const project of projects) {
        const result = await fetchProjectStats(project.id);
        if (result) {
          stats[project.id] = result;
        }
      }
      setProjectStats(stats);
    };

    if (projects.length > 0) {
      fetchStats();
    }
  }, [projects, fetchProjectStats]);

  // 除外済みプロジェクトを取得
  useEffect(() => {
    if (excludedOpen) {
      fetchExcludedProjects().then(setExcludedProjects);
    }
  }, [excludedOpen, fetchExcludedProjects]);

  const handleAutoDetect = async () => {
    const result = await autoDetect();
    if (result) {
      setAutoDetectResult({
        detected: result.detected,
        created: result.created,
      });
      setTimeout(() => setAutoDetectResult(null), 5000);
    }
  };

  const handleScanGitRepos = async () => {
    const result = await scanGitRepos();
    if (result) {
      setScanResult(result);
      setTimeout(() => setScanResult(null), 5000);
    }
  };

  const handleExclude = async (project: Project) => {
    if (!window.confirm(`「${project.name}」を除外しますか? 除外後も復活できます。`)) {
      return;
    }
    await excludeProject(project.id);
  };

  const handleRestore = async (project: Project) => {
    await restoreProject(project.id);
    // 除外済みリストを更新
    setExcludedProjects((prev) => prev.filter((p) => p.id !== project.id));
  };

  const handleDelete = async (project: Project) => {
    if (!window.confirm(`「${project.name}」を完全に削除しますか? この操作は取り消せません。`)) {
      return;
    }
    await deleteProject(project.id);
  };

  if (loading) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
              <Skeleton key={id} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-indigo-500" />
              Projects
              {projects.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {projects.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setSettingsDialogOpen(true)}
                title="スキャン設定"
                className="h-8 w-8"
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={handleScanGitRepos}
                disabled={scanning}
                title="Git リポジトリをスキャン"
                className="h-8 w-8"
              >
                <FolderGit2 className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={handleAutoDetect}
                disabled={autoDetecting}
                title="既存データから自動検出"
                className="h-8 w-8"
              >
                <Search className={`h-4 w-4 ${autoDetecting ? "animate-pulse" : ""}`} />
              </Button>
              <Button
                size="icon"
                onClick={() => setCreateDialogOpen(true)}
                title="新規作成"
                className="h-8 w-8"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {error && <p className="mb-4 shrink-0 text-sm text-destructive">{error}</p>}

          {autoDetectResult && (
            <p className="mb-4 shrink-0 text-sm text-muted-foreground">
              {autoDetectResult.detected} 件検出
              {autoDetectResult.created > 0
                ? `、${autoDetectResult.created} 件の候補が見つかりました。Tasks タブで確認してください。`
                : ""}
            </p>
          )}

          {scanResult && (
            <p className="mb-4 shrink-0 text-sm text-muted-foreground">
              {scanResult.scanned} 件スキャン
              {scanResult.created > 0
                ? `、${scanResult.created} 件の候補が見つかりました。Tasks タブで確認してください。`
                : `、${scanResult.skipped} 件スキップ`}
            </p>
          )}

          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              プロジェクトがありません。「新規作成」または「自動検出」でプロジェクトを追加してください。
            </p>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 pr-4">
                {projects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    stats={projectStats[project.id]}
                    isSelected={selectedProjectId === project.id}
                    onSelect={onSelectProject ? () => onSelectProject(project) : undefined}
                    onEdit={() => setEditingProject(project)}
                    onExclude={() => handleExclude(project)}
                    onDelete={() => handleDelete(project)}
                  />
                ))}
              </div>

              {/* 除外済みセクション */}
              <Collapsible open={excludedOpen} onOpenChange={setExcludedOpen} className="mt-4">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
                    {excludedOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Archive className="h-4 w-4" />
                    除外済み ({excludedProjects.length})
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {excludedProjects.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">
                      除外済みプロジェクトはありません
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {excludedProjects.map((project) => (
                        <ExcludedProjectItem
                          key={project.id}
                          project={project}
                          onRestore={() => handleRestore(project)}
                          onDelete={() => handleDelete(project)}
                        />
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* 新規作成ダイアログ */}
      <ProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={async (data) => {
          const result = await createProject(data);
          if (result) {
            setCreateDialogOpen(false);
          }
        }}
      />

      {/* 編集ダイアログ */}
      {editingProject && (
        <ProjectDialog
          open={!!editingProject}
          onOpenChange={(open) => {
            if (!open) setEditingProject(null);
          }}
          project={editingProject}
          onSubmit={async (data) => {
            const result = await updateProject(editingProject.id, data);
            if (result) {
              setEditingProject(null);
            }
          }}
        />
      )}

      {/* スキャン設定ダイアログ */}
      <ScanSettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
    </div>
  );
}

interface ProjectItemProps {
  project: Project;
  stats?: ProjectStats;
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit: () => void;
  onExclude: () => void;
  onDelete: () => void;
}

function ProjectItem({
  project,
  stats,
  isSelected,
  onSelect,
  onEdit,
  onExclude,
  onDelete,
}: ProjectItemProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role is conditionally set based on onSelect
    <div
      className={cn(
        "rounded-md border p-3 transition-colors",
        onSelect && "cursor-pointer hover:bg-muted/50",
        isSelected && "border-primary bg-primary/5",
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{project.name}</span>
            {!project.isActive && (
              <Badge variant="outline" className="text-muted-foreground">
                非アクティブ
              </Badge>
            )}
          </div>
          {/* 複数リポジトリ表示 */}
          {project.repositories && project.repositories.length > 0 && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {project.repositories.map((repo) => (
                <div key={repo.id} className="flex items-center gap-1">
                  <Github className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {repo.githubOwner}/{repo.githubRepo}
                  </span>
                  {repo.localPath && (
                    <span className="truncate opacity-60" title={repo.localPath}>
                      ({repo.localPath})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* 後方互換性: repositories がない場合 */}
          {(!project.repositories || project.repositories.length === 0) && (
            <>
              {project.path && (
                <p className="truncate text-xs text-muted-foreground" title={project.path}>
                  {project.path}
                </p>
              )}
              {project.githubOwner && project.githubRepo && (
                <p className="text-xs text-muted-foreground">
                  <Github className="mr-1 inline h-3 w-3" />
                  {project.githubOwner}/{project.githubRepo}
                </p>
              )}
            </>
          )}
          {stats && (
            <p className="text-xs text-muted-foreground">
              タスク: {stats.tasksCount} / 学び: {stats.learningsCount}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" onClick={onEdit} title="編集" className="h-7 w-7">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onExclude}
            title="除外"
            className="h-7 w-7 text-muted-foreground hover:text-orange-500"
          >
            <Archive className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            title="完全削除"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ExcludedProjectItemProps {
  project: Project;
  onRestore: () => void;
  onDelete: () => void;
}

function ExcludedProjectItem({ project, onRestore, onDelete }: ExcludedProjectItemProps) {
  // リポジトリからローカルパスを取得
  const localPaths =
    project.repositories?.map((r) => r.localPath).filter((p): p is string => p !== null) ?? [];
  const displayPath = localPaths[0] ?? project.path;

  return (
    <div className="rounded-md border border-dashed p-3 opacity-60">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <span className="truncate font-medium">{project.name}</span>
          {displayPath && (
            <p className="truncate text-xs text-muted-foreground" title={displayPath}>
              {displayPath}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onRestore}
            title="復活"
            className="h-7 w-7 text-muted-foreground hover:text-green-500"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            title="完全削除"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (data: {
    name: string;
    repositories?: Array<{ githubOwner: string; githubRepo: string; localPath?: string }>;
    isActive?: boolean;
  }) => Promise<void>;
}

interface RepoInput {
  githubOwner: string;
  githubRepo: string;
  localPath: string;
}

function ProjectDialog({ open, onOpenChange, project, onSubmit }: ProjectDialogProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [repositories, setRepositories] = useState<RepoInput[]>([]);
  const [isActive, setIsActive] = useState(project?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);

  // プロジェクトが変わったらフォームをリセット
  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      // 既存のリポジトリを読み込み
      if (project?.repositories && project.repositories.length > 0) {
        setRepositories(
          project.repositories.map((r) => ({
            githubOwner: r.githubOwner,
            githubRepo: r.githubRepo,
            localPath: r.localPath ?? "",
          })),
        );
      } else if (project?.githubOwner && project?.githubRepo) {
        // 後方互換性: 旧フィールドから
        setRepositories([
          {
            githubOwner: project.githubOwner,
            githubRepo: project.githubRepo,
            localPath: project.path ?? "",
          },
        ]);
      } else {
        setRepositories([]);
      }
      setIsActive(project?.isActive ?? true);
    }
  }, [open, project]);

  const addRepository = () => {
    setRepositories([...repositories, { githubOwner: "", githubRepo: "", localPath: "" }]);
  };

  const removeRepository = (index: number) => {
    setRepositories(repositories.filter((_, i) => i !== index));
  };

  const updateRepository = (
    index: number,
    field: "githubOwner" | "githubRepo" | "localPath",
    value: string,
  ) => {
    const updated = [...repositories];
    const current = updated[index];
    if (current) {
      updated[index] = { ...current, [field]: value };
      setRepositories(updated);
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      // 空のリポジトリを除外
      const validRepos = repositories
        .filter((r) => r.githubOwner.trim() && r.githubRepo.trim())
        .map((r) => ({
          githubOwner: r.githubOwner.trim(),
          githubRepo: r.githubRepo.trim(),
          localPath: r.localPath.trim() || undefined,
        }));
      await onSubmit({
        name: name.trim(),
        repositories: validRepos.length > 0 ? validRepos : undefined,
        isActive,
      });
    } finally {
      setSubmitting(false);
    }
  }, [name, repositories, isActive, onSubmit]);

  // キーボードショートカット (Cmd/Ctrl+Enter で送信)
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (name.trim() && !submitting) {
          handleSubmit();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, name, submitting, handleSubmit]);

  const isEditing = !!project;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "プロジェクト編集" : "プロジェクト作成"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "プロジェクト情報を編集します" : "新しいプロジェクトを作成します"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">名前 *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: my-project"
              disabled={submitting}
            />
          </div>

          {/* GitHub リポジトリ (複数対応) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>リポジトリ</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addRepository}
                disabled={submitting}
                className="h-7"
              >
                <Plus className="mr-1 h-3 w-3" />
                追加
              </Button>
            </div>
            {repositories.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                リポジトリを追加すると、GitHub Issues/PRs と連携できます
              </p>
            ) : (
              <div className="space-y-3">
                {repositories.map((repo, index) => (
                  <div key={`repo-${index}`} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={repo.githubOwner}
                        onChange={(e) => updateRepository(index, "githubOwner", e.target.value)}
                        placeholder="owner"
                        disabled={submitting}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground">/</span>
                      <Input
                        value={repo.githubRepo}
                        onChange={(e) => updateRepository(index, "githubRepo", e.target.value)}
                        placeholder="repo"
                        disabled={submitting}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeRepository(index)}
                        disabled={submitting}
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      value={repo.localPath}
                      onChange={(e) => updateRepository(index, "localPath", e.target.value)}
                      placeholder="ローカルパス (例: /Users/username/projects/repo)"
                      disabled={submitting}
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {isEditing && (
            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={submitting}
              />
              <Label htmlFor="isActive">アクティブ</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || submitting}>
            {submitting ? "保存中..." : isEditing ? "更新" : "作成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScanSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ScanSettingsDialog({ open, onOpenChange }: ScanSettingsDialogProps) {
  const { config, loading, updateConfig } = useProjectsConfig();
  const [scanPaths, setScanPaths] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 設定が読み込まれたらフォームを更新
  useEffect(() => {
    if (open && !loading) {
      setScanPaths(config.gitScanPaths.join("\n"));
    }
  }, [open, loading, config.gitScanPaths]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const paths = scanPaths
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const success = await updateConfig({ gitScanPaths: paths });
      if (success) {
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  }, [scanPaths, updateConfig, onOpenChange]);

  // キーボードショートカット (Cmd/Ctrl+Enter で送信)
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!submitting) {
          handleSubmit();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, submitting, handleSubmit]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Git スキャン設定</DialogTitle>
          <DialogDescription>
            Git リポジトリを探索するディレクトリを設定します。1行に1パスを入力してください。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="scanPaths">探索対象ディレクトリ</Label>
            <Textarea
              id="scanPaths"
              value={scanPaths}
              onChange={(e) => setScanPaths(e.target.value)}
              placeholder={"~/projects\n~/work\n/path/to/repos"}
              rows={5}
              disabled={loading || submitting}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">~ はホームディレクトリに展開されます</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={loading || submitting}>
            {submitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
