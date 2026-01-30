/**
 * Projects Panel
 *
 * プロジェクト管理パネル
 */

import type { Project, ProjectStats } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              Projects
              {projects.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {projects.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              プロジェクトを管理します。タスクや学びをプロジェクトに紐付けできます。
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleAutoDetect} disabled={autoDetecting}>
              {autoDetecting ? "検出中..." : "自動検出"}
            </Button>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              新規作成
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          {autoDetectResult && (
            <p className="mb-4 text-sm text-muted-foreground">
              {autoDetectResult.detected} 件検出、{autoDetectResult.created} 件作成しました
            </p>
          )}

          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              プロジェクトがありません。「新規作成」または「自動検出」でプロジェクトを追加してください。
            </p>
          ) : (
            <ScrollArea className="h-[320px]">
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
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            編集
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            削除
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
