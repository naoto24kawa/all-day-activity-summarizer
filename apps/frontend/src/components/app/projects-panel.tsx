/**
 * Projects Panel
 *
 * プロジェクト管理パネル
 */

import type { Project, ProjectStats } from "@repo/types";
import {
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useProjects } from "@/hooks/use-projects";

export function ProjectsPanel() {
  const {
    projects,
    loading,
    error,
    autoDetecting,
    createProject,
    updateProject,
    deleteProject,
    fetchProjectStats,
    autoDetect,
  } = useProjects(false); // 全プロジェクトを取得

  const [isOpen, setIsOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [autoDetectResult, setAutoDetectResult] = useState<{
    detected: number;
    created: number;
  } | null>(null);

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

  const handleDelete = async (project: Project) => {
    if (!window.confirm(`「${project.name}」を削除しますか? この操作は取り消せません。`)) {
      return;
    }
    await deleteProject(project.id);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CollapsibleTrigger asChild>
            <CardHeader className="shrink-0 cursor-pointer select-none hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <FolderKanban className="h-5 w-5 text-indigo-500" />
                  Projects
                  {projects.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {projects.length}
                    </Badge>
                  )}
                </CardTitle>
                <div
                  className="flex gap-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={handleAutoDetect}
                    disabled={autoDetecting}
                    title="自動検出"
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
              {!isOpen && (
                <CardDescription className="mt-1 text-xs">クリックして展開</CardDescription>
              )}
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="flex min-h-0 flex-1 flex-col">
              <CardDescription className="mb-3">
                プロジェクトを管理します。タスクや学びをプロジェクトに紐付けできます。
              </CardDescription>
              {error && <p className="mb-4 shrink-0 text-sm text-destructive">{error}</p>}

              {autoDetectResult && (
                <p className="mb-4 shrink-0 text-sm text-muted-foreground">
                  {autoDetectResult.detected} 件検出、{autoDetectResult.created} 件作成しました
                </p>
              )}

              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  プロジェクトがありません。「新規作成」または「自動検出」でプロジェクトを追加してください。
                </p>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-3">
                    {projects.map((project) => (
                      <ProjectItem
                        key={project.id}
                        project={project}
                        stats={projectStats[project.id]}
                        onEdit={() => setEditingProject(project)}
                        onDelete={() => handleDelete(project)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

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
    </>
  );
}

interface ProjectItemProps {
  project: Project;
  stats?: ProjectStats;
  onEdit: () => void;
  onDelete: () => void;
}

function ProjectItem({ project, stats, onEdit, onDelete }: ProjectItemProps) {
  return (
    <div className="rounded-md border p-3">
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
          {project.path && (
            <p className="truncate text-xs text-muted-foreground" title={project.path}>
              {project.path}
            </p>
          )}
          {project.githubOwner && project.githubRepo && (
            <p className="text-xs text-muted-foreground">
              GitHub: {project.githubOwner}/{project.githubRepo}
            </p>
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
            onClick={onDelete}
            title="削除"
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
    path?: string;
    githubOwner?: string;
    githubRepo?: string;
    isActive?: boolean;
  }) => Promise<void>;
}

function ProjectDialog({ open, onOpenChange, project, onSubmit }: ProjectDialogProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [path, setPath] = useState(project?.path ?? "");
  const [githubOwner, setGithubOwner] = useState(project?.githubOwner ?? "");
  const [githubRepo, setGithubRepo] = useState(project?.githubRepo ?? "");
  const [isActive, setIsActive] = useState(project?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);

  // プロジェクトが変わったらフォームをリセット
  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setPath(project?.path ?? "");
      setGithubOwner(project?.githubOwner ?? "");
      setGithubRepo(project?.githubRepo ?? "");
      setIsActive(project?.isActive ?? true);
    }
  }, [open, project]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        path: path.trim() || undefined,
        githubOwner: githubOwner.trim() || undefined,
        githubRepo: githubRepo.trim() || undefined,
        isActive,
      });
    } finally {
      setSubmitting(false);
    }
  }, [name, path, githubOwner, githubRepo, isActive, onSubmit]);

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
      <DialogContent>
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
          <div className="space-y-2">
            <Label htmlFor="path">パス</Label>
            <Input
              id="path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="例: /Users/username/projects/my-project"
              disabled={submitting}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="githubOwner">GitHub Owner</Label>
              <Input
                id="githubOwner"
                value={githubOwner}
                onChange={(e) => setGithubOwner(e.target.value)}
                placeholder="例: myorg"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="githubRepo">GitHub Repo</Label>
              <Input
                id="githubRepo"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="例: my-repo"
                disabled={submitting}
              />
            </div>
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
