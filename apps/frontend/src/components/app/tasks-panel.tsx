/**
 * Tasks Panel Component
 *
 * Slack メッセージから抽出したタスクの表示・管理
 */

import {
  type DuplicateTaskPair,
  isApprovalOnlyTask,
  type Project,
  type SuggestCompletionsResponse,
  type Task,
  type TaskCompletionSuggestion,
  type TaskSourceType,
  type TaskStatus,
} from "@repo/types";
import {
  AlertTriangle,
  Bell,
  BellOff,
  BookOpen,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardCopy,
  FileText,
  Filter,
  FolderGit2,
  FolderKanban,
  Github,
  GitMerge,
  MessageSquare,
  MessageSquareMore,
  Mic,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Signal,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNotifications } from "@/hooks/use-notifications";
import { getProjectName, useProjects } from "@/hooks/use-projects";
import {
  useGenerateImprovement,
  usePromptImprovement,
  usePromptImprovementStats,
} from "@/hooks/use-prompt-improvements";
import { useTaskStats, useTasks } from "@/hooks/use-tasks";
import { ADAS_API_URL, postAdasApi } from "@/lib/adas-api";
import { DuplicateSuggestionsPanel } from "./duplicate-suggestions-panel";
import { TaskElaborateDialog } from "./task-elaborate-dialog";

interface TasksPanelProps {
  date: string;
  className?: string;
}

/** タスクのスタイルマップ */
const TASK_STATUS_STYLES: Record<TaskStatus | "selected" | "suggested", string> = {
  selected: "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-950",
  completed: "opacity-60",
  rejected: "opacity-50",
  pending: "border-primary/30 bg-primary/5",
  in_progress: "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950",
  paused: "border-yellow-400 bg-yellow-50 dark:border-yellow-600 dark:bg-yellow-950",
  suggested: "border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-950",
  accepted: "",
};

/** ソースタイプのラベルマップ */
const SOURCE_LABELS: Record<TaskSourceType, string> = {
  slack: "Slack",
  github: "GitHub",
  "github-comment": "GitHub Comment",
  memo: "Memo",
  "prompt-improvement": "改善",
  vocabulary: "用語",
  merge: "統合",
  "profile-suggestion": "プロフィール",
};

/** タスクのスタイルを取得 */
function getTaskStyle(task: Task, isSelected: boolean, isSuggested?: boolean): string {
  if (isSelected) return TASK_STATUS_STYLES.selected;
  if (isSuggested && task.status === "accepted") return TASK_STATUS_STYLES.suggested;
  return TASK_STATUS_STYLES[task.status] ?? "";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex UI component with many states
export function TasksPanel({ date, className }: TasksPanelProps) {
  const {
    tasks,
    loading,
    error,
    refetch,
    updateTask,
    updateBatchTasks,
    deleteTask,
    extractTasksAsync,
    extractGitHubTasksAsync,
    extractGitHubCommentTasksAsync,
    extractMemoTasksAsync,
    detectDuplicates,
    createMergeTask,
    elaborateTask,
  } = useTasks();
  const { stats } = useTaskStats(date);
  const {
    projects,
    loading: projectsLoading,
    autoDetecting,
    createProject,
    updateProject,
    deleteProject,
    autoDetect,
  } = useProjects(false);
  const { permission, requestPermission, notifyHighPriorityTask } = useNotifications();
  const [extracting, setExtracting] = useState(false);

  // プロンプト改善
  const { stats: promptStats, refetch: refetchPromptStats } = usePromptImprovementStats();
  const { generate: generateImprovement, generating: generatingImprovement } =
    useGenerateImprovement();

  const [sourceFilter, setSourceFilter] = useState<TaskSourceType | "all">("all");
  const [projectFilter, setProjectFilter] = useState<number | "all" | "none">("all");
  const [checkingCompletion, setCheckingCompletion] = useState(false);

  // Projects Popover state
  const [projectsPopoverOpen, setProjectsPopoverOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [projectPathInput, setProjectPathInput] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");

  // 一括操作モード
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [completionSuggestions, setCompletionSuggestions] = useState<TaskCompletionSuggestion[]>(
    [],
  );

  // 重複検出
  const [detectingDuplicates, setDetectingDuplicates] = useState(false);
  const [duplicateSuggestions, setDuplicateSuggestions] = useState<DuplicateTaskPair[]>([]);

  // タスク詳細化
  const [elaborateDialogOpen, setElaborateDialogOpen] = useState(false);
  const [elaborateTargetTask, setElaborateTargetTask] = useState<Task | null>(null);

  const openElaborateDialog = (task: Task) => {
    setElaborateTargetTask(task);
    setElaborateDialogOpen(true);
  };

  const closeElaborateDialog = () => {
    setElaborateDialogOpen(false);
    setElaborateTargetTask(null);
  };

  const handleApplyElaboration = async (taskId: number, description: string) => {
    await updateTask(taskId, { description });
  };

  const getSourceLabel = (sourceType: TaskSourceType) => SOURCE_LABELS[sourceType] ?? "Slack";

  // Projects Popover handlers
  const handleStartProjectEdit = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectNameInput(project.name);
    setProjectPathInput(project.path ?? "");
  };

  const handleCancelProjectEdit = () => {
    setEditingProjectId(null);
    setProjectNameInput("");
    setProjectPathInput("");
  };

  const handleSaveProject = async (projectId: number) => {
    if (!projectNameInput.trim()) return;
    await updateProject(projectId, {
      name: projectNameInput.trim(),
      path: projectPathInput.trim() || undefined,
    });
    handleCancelProjectEdit();
  };

  const handleDeleteProject = async (project: Project) => {
    if (!window.confirm(`「${project.name}」を削除しますか?`)) return;
    await deleteProject(project.id);
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    await createProject({
      name: newProjectName.trim(),
      path: newProjectPath.trim() || undefined,
    });
    setCreatingProject(false);
    setNewProjectName("");
    setNewProjectPath("");
  };

  const handleAutoDetect = async () => {
    await autoDetect();
  };

  // Filter tasks by source type and project
  const filterTasks = (taskList: Task[]) => {
    let result = taskList;

    // Source filter
    if (sourceFilter !== "all") {
      // GitHub filter includes both github and github-comment
      if (sourceFilter === "github") {
        result = result.filter(
          (t) => t.sourceType === "github" || t.sourceType === "github-comment",
        );
      } else {
        result = result.filter((t) => t.sourceType === sourceFilter);
      }
    }

    // Project filter
    if (projectFilter !== "all") {
      if (projectFilter === "none") {
        result = result.filter((t) => t.projectId === null);
      } else {
        result = result.filter((t) => t.projectId === projectFilter);
      }
    }

    return result;
  };

  // Sort by priority (for accepted tasks)
  type TaskPriority = "high" | "medium" | "low";
  const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
  const sortByPriority = (taskList: Task[]) => {
    return [...taskList].sort((a, b) => {
      const aPriority = a.priority ? priorityOrder[a.priority as TaskPriority] : 3;
      const bPriority = b.priority ? priorityOrder[b.priority as TaskPriority] : 3;
      return aPriority - bPriority;
    });
  };

  // Sort by extractedAt descending (for non-accepted tasks)
  const sortByDateDesc = (taskList: Task[]) => {
    return [...taskList].sort((a, b) => {
      return new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime();
    });
  };

  const notifyHighPriorityTasks = (extractedTasks: Task[]) => {
    const highPriorityTasks = extractedTasks.filter((t) => t.priority === "high");
    for (const task of highPriorityTasks) {
      notifyHighPriorityTask(task.title, getSourceLabel(task.sourceType));
    }
  };

  // 非同期版: ジョブをキューに登録 (結果はSSE通知で受け取る)
  const handleExtractSlack = async () => {
    setExtracting(true);
    try {
      await extractTasksAsync({ date });
      // ジョブ登録完了 - 実際の結果はSSE通知で受け取る
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractGitHub = async () => {
    setExtracting(true);
    try {
      await extractGitHubTasksAsync({ date });
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractGitHubComments = async () => {
    setExtracting(true);
    try {
      await extractGitHubCommentTasksAsync({ date });
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractMemos = async () => {
    setExtracting(true);
    try {
      await extractMemoTasksAsync({ date });
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractAll = async () => {
    setExtracting(true);
    try {
      // 全ての抽出ジョブを並列でキューに登録
      await Promise.all([
        extractTasksAsync({ date }),
        extractGitHubTasksAsync({ date }),
        extractGitHubCommentTasksAsync({ date }),
        extractMemoTasksAsync({ date }),
      ]);
      // ジョブ登録完了 - 実際の結果はSSE通知で受け取る
    } finally {
      setExtracting(false);
    }
  };

  const handleCheckCompletions = async () => {
    setCheckingCompletion(true);
    setCompletionSuggestions([]);
    try {
      const data = await postAdasApi<SuggestCompletionsResponse>("/api/tasks/suggest-completions", {
        date,
      });
      setCompletionSuggestions(data.suggestions);
    } catch (err) {
      console.error("Failed to check completions:", err);
    } finally {
      setCheckingCompletion(false);
    }
  };

  const handleCompleteFromSuggestion = async (taskId: number) => {
    await updateTask(taskId, { status: "completed" });
    setCompletionSuggestions((prev) => prev.filter((s) => s.taskId !== taskId));
  };

  const handleDetectDuplicates = async () => {
    setDetectingDuplicates(true);
    setDuplicateSuggestions([]);
    try {
      const result = await detectDuplicates({ date });
      setDuplicateSuggestions(result.duplicates);
    } catch (err) {
      console.error("Failed to detect duplicates:", err);
    } finally {
      setDetectingDuplicates(false);
    }
  };

  const handleMergeDuplicates = async (
    pair: DuplicateTaskPair,
    title: string,
    description: string | null,
  ) => {
    try {
      await createMergeTask({
        sourceTaskIds: [pair.taskAId, pair.taskBId],
        title,
        description: description ?? undefined,
      });
      // 統合済みのペアを除外
      setDuplicateSuggestions((prev) =>
        prev.filter(
          (p) =>
            !(p.taskAId === pair.taskAId && p.taskBId === pair.taskBId) &&
            !(p.taskAId === pair.taskBId && p.taskBId === pair.taskAId),
        ),
      );
    } catch (err) {
      console.error("Failed to create merge task:", err);
    }
  };

  const handleDismissDuplicate = (pair: DuplicateTaskPair) => {
    setDuplicateSuggestions((prev) =>
      prev.filter(
        (p) =>
          !(p.taskAId === pair.taskAId && p.taskBId === pair.taskBId) &&
          !(p.taskAId === pair.taskBId && p.taskBId === pair.taskAId),
      ),
    );
  };

  // 一括操作ハンドラー
  const toggleTaskSelection = (taskId: number) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const selectAllInTab = (taskList: Task[]) => {
    setSelectedTaskIds(new Set(taskList.map((t) => t.id)));
  };

  const clearSelection = () => {
    setSelectedTaskIds(new Set());
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedTaskIds(new Set());
  };

  const handleBatchUpdate = async (updates: {
    status?: TaskStatus;
    projectId?: number | null;
    priority?: "high" | "medium" | "low" | null;
    reason?: string;
  }) => {
    if (selectedTaskIds.size === 0) return;
    setBatchUpdating(true);
    try {
      await updateBatchTasks(Array.from(selectedTaskIds), updates);
      clearSelection();
    } finally {
      setBatchUpdating(false);
    }
  };

  const suggestionTaskIds = new Set(completionSuggestions.map((s) => s.taskId));

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
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
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const pendingTasks = sortByDateDesc(filterTasks(tasks.filter((t) => t.status === "pending")));
  const acceptedTasks = sortByPriority(filterTasks(tasks.filter((t) => t.status === "accepted")));
  const inProgressTasks = sortByDateDesc(
    filterTasks(tasks.filter((t) => t.status === "in_progress")),
  );
  const pausedTasks = sortByDateDesc(filterTasks(tasks.filter((t) => t.status === "paused")));
  const completedTasks = sortByDateDesc(filterTasks(tasks.filter((t) => t.status === "completed")));
  const rejectedTasks = sortByDateDesc(filterTasks(tasks.filter((t) => t.status === "rejected")));

  // Count tasks by source for filter badges
  const sourceCount = {
    all: tasks.length,
    slack: tasks.filter((t) => t.sourceType === "slack").length,
    github: tasks.filter((t) => t.sourceType === "github" || t.sourceType === "github-comment")
      .length,
    "prompt-improvement": tasks.filter((t) => t.sourceType === "prompt-improvement").length,
    memo: tasks.filter((t) => t.sourceType === "memo").length,
    vocabulary: tasks.filter((t) => t.sourceType === "vocabulary").length,
  };

  // Count tasks by project for filter badges
  const projectCount = new Map<number | "none", number>();
  projectCount.set("none", 0);
  for (const task of tasks) {
    if (task.projectId === null) {
      projectCount.set("none", (projectCount.get("none") ?? 0) + 1);
    } else {
      projectCount.set(task.projectId, (projectCount.get(task.projectId) ?? 0) + 1);
    }
  }

  // Get projects that have tasks
  const projectsWithTasks = projects.filter(
    (p) => projectCount.has(p.id) && (projectCount.get(p.id) ?? 0) > 0,
  );

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="flex shrink-0 flex-col gap-1 space-y-0 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Tasks
            {stats.pending > 0 && (
              <Badge variant="destructive" className="ml-2">
                {stats.pending} 件の承認待ち
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {/* 一括操作モードトグル */}
            <Button
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
              title={selectionMode ? "一括操作モードを終了" : "一括操作モードを開始"}
            >
              {selectionMode ? (
                <>
                  <X className="mr-1 h-3 w-3" />
                  終了
                </>
              ) : (
                <>
                  <CheckSquare className="mr-1 h-3 w-3" />
                  一括
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExtractAll}
              disabled={extracting}
              title="Extract tasks from Slack and GitHub"
            >
              <Sparkles className={`mr-1 h-3 w-3 ${extracting ? "animate-pulse" : ""}`} />
              {extracting ? "..." : "Extract"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExtractSlack}
              disabled={extracting}
              title="Extract from Slack"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExtractGitHub}
              disabled={extracting}
              title="Extract from GitHub Items"
            >
              <Github className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExtractGitHubComments}
              disabled={extracting}
              title="Extract from GitHub Comments"
            >
              <MessageSquareMore className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExtractMemos}
              disabled={extracting}
              title="Extract from Memos"
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckCompletions}
              disabled={checkingCompletion || stats.accepted === 0}
              title="Check task completions"
            >
              <Search className={`mr-1 h-3 w-3 ${checkingCompletion ? "animate-pulse" : ""}`} />
              {checkingCompletion ? "..." : "完了チェック"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDetectDuplicates}
              disabled={detectingDuplicates || stats.accepted < 2}
              title="Detect duplicate tasks"
            >
              <GitMerge className={`mr-1 h-3 w-3 ${detectingDuplicates ? "animate-pulse" : ""}`} />
              {detectingDuplicates ? "..." : "重複検出"}
            </Button>
            {permission === "default" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={requestPermission}
                title="Enable notifications"
              >
                <BellOff className="h-4 w-4" />
              </Button>
            )}
            {permission === "granted" && (
              <Button variant="ghost" size="icon" disabled title="Notifications enabled">
                <Bell className="h-4 w-4 text-green-500" />
              </Button>
            )}
            {/* Projects Popover */}
            <Popover open={projectsPopoverOpen} onOpenChange={setProjectsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" title="Projects">
                  <FolderKanban className="mr-1 h-3 w-3" />
                  Projects
                  {projects.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                      {projects.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96 p-0" align="end">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div>
                    <h4 className="font-medium text-sm">Projects</h4>
                    <p className="text-xs text-muted-foreground">
                      タスクや学びをプロジェクトに紐付け
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={handleAutoDetect}
                      disabled={autoDetecting}
                      title="自動検出"
                      className="h-7 w-7"
                    >
                      <Search className={`h-3 w-3 ${autoDetecting ? "animate-pulse" : ""}`} />
                    </Button>
                    <Button
                      size="icon"
                      onClick={() => setCreatingProject(true)}
                      title="新規作成"
                      className="h-7 w-7"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {projectsLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">読み込み中...</div>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2 p-2">
                      {/* 新規作成フォーム */}
                      {creatingProject && (
                        <div className="rounded-md border border-primary p-2 space-y-2">
                          <Input
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="プロジェクト名"
                            className="h-7 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCreateProject();
                              if (e.key === "Escape") {
                                setCreatingProject(false);
                                setNewProjectName("");
                                setNewProjectPath("");
                              }
                            }}
                          />
                          <Input
                            value={newProjectPath}
                            onChange={(e) => setNewProjectPath(e.target.value)}
                            placeholder="パス (オプション)"
                            className="h-7 text-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCreateProject();
                              if (e.key === "Escape") {
                                setCreatingProject(false);
                                setNewProjectName("");
                                setNewProjectPath("");
                              }
                            }}
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={handleCreateProject}
                              disabled={!newProjectName.trim()}
                            >
                              作成
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => {
                                setCreatingProject(false);
                                setNewProjectName("");
                                setNewProjectPath("");
                              }}
                            >
                              キャンセル
                            </Button>
                          </div>
                        </div>
                      )}
                      {projects.length === 0 && !creatingProject ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          プロジェクトがありません
                        </div>
                      ) : (
                        projects.map((project) => (
                          <div
                            key={project.id}
                            className={`rounded-md border p-2 text-sm ${!project.isActive ? "opacity-50" : ""}`}
                          >
                            {editingProjectId === project.id ? (
                              <div className="space-y-2">
                                <Input
                                  value={projectNameInput}
                                  onChange={(e) => setProjectNameInput(e.target.value)}
                                  placeholder="プロジェクト名"
                                  className="h-7 text-xs"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveProject(project.id);
                                    if (e.key === "Escape") handleCancelProjectEdit();
                                  }}
                                />
                                <Input
                                  value={projectPathInput}
                                  onChange={(e) => setProjectPathInput(e.target.value)}
                                  placeholder="パス (オプション)"
                                  className="h-7 text-xs"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveProject(project.id);
                                    if (e.key === "Escape") handleCancelProjectEdit();
                                  }}
                                />
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => handleSaveProject(project.id)}
                                    disabled={!projectNameInput.trim()}
                                  >
                                    保存
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                    onClick={handleCancelProjectEdit}
                                  >
                                    キャンセル
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{project.name}</span>
                                  {!project.isActive && (
                                    <Badge variant="outline" className="text-xs">
                                      非アクティブ
                                    </Badge>
                                  )}
                                </div>
                                {project.path && (
                                  <p
                                    className="text-xs text-muted-foreground truncate"
                                    title={project.path}
                                  >
                                    {project.path}
                                  </p>
                                )}
                                <div className="mt-1 flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => handleStartProjectEdit(project)}
                                  >
                                    編集
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDeleteProject(project)}
                                  >
                                    削除
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                )}
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          AIがSlack/GitHubから抽出したタスク候補です。承認するとタスク化されます。
        </p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {/* Source Filter Buttons */}
        {tasks.length > 0 && (
          <div className="mb-3 flex shrink-0 items-center gap-1">
            <Filter className="mr-1 h-3 w-3 text-muted-foreground" />
            <Button
              variant={sourceFilter === "all" ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setSourceFilter("all")}
            >
              全て {sourceCount.all > 0 && `(${sourceCount.all})`}
            </Button>
            {sourceCount.slack > 0 && (
              <Button
                variant={sourceFilter === "slack" ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setSourceFilter("slack")}
              >
                <MessageSquare className="mr-1 h-3 w-3" />
                Slack ({sourceCount.slack})
              </Button>
            )}
            {sourceCount.github > 0 && (
              <Button
                variant={
                  sourceFilter === "github" || sourceFilter === "github-comment"
                    ? "default"
                    : "outline"
                }
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setSourceFilter("github")}
              >
                <Github className="mr-1 h-3 w-3" />
                GitHub ({sourceCount.github})
              </Button>
            )}
            {sourceCount["prompt-improvement"] > 0 && (
              <Button
                variant={sourceFilter === "prompt-improvement" ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setSourceFilter("prompt-improvement")}
              >
                <Wand2 className="mr-1 h-3 w-3" />
                改善 ({sourceCount["prompt-improvement"]})
              </Button>
            )}
            {sourceCount.memo > 0 && (
              <Button
                variant={sourceFilter === "memo" ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setSourceFilter("memo")}
              >
                <FileText className="mr-1 h-3 w-3" />
                Memo ({sourceCount.memo})
              </Button>
            )}
            {sourceCount.vocabulary > 0 && (
              <Button
                variant={sourceFilter === "vocabulary" ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setSourceFilter("vocabulary")}
              >
                <BookOpen className="mr-1 h-3 w-3" />
                用語 ({sourceCount.vocabulary})
              </Button>
            )}
          </div>
        )}

        {/* Project Filter Buttons */}
        {tasks.length > 0 && projectsWithTasks.length > 0 && (
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1">
            <FolderGit2 className="mr-1 h-3 w-3 text-muted-foreground" />
            <Button
              variant={projectFilter === "all" ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setProjectFilter("all")}
            >
              全プロジェクト
            </Button>
            {projectsWithTasks.map((project) => (
              <Button
                key={project.id}
                variant={projectFilter === project.id ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setProjectFilter(project.id)}
              >
                {project.name} ({projectCount.get(project.id) ?? 0})
              </Button>
            ))}
            {(projectCount.get("none") ?? 0) > 0 && (
              <Button
                variant={projectFilter === "none" ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setProjectFilter("none")}
              >
                未分類 ({projectCount.get("none")})
              </Button>
            )}
          </div>
        )}

        {/* 一括操作バー */}
        {selectionMode && (
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-blue-50 p-2 dark:bg-blue-950">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">
                {selectedTaskIds.size > 0
                  ? `${selectedTaskIds.size}件選択中`
                  : "タスクを選択してください"}
              </span>
            </div>
            {selectedTaskIds.size > 0 && (
              <>
                <div className="h-4 w-px bg-border" />
                {/* ステータス一括変更 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7" disabled={batchUpdating}>
                      <Circle className="mr-1 h-3 w-3" />
                      ステータス
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => handleBatchUpdate({ status: "accepted" })}>
                      <Check className="mr-2 h-4 w-4 text-green-500" />
                      承認
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBatchUpdate({ status: "rejected" })}>
                      <X className="mr-2 h-4 w-4 text-red-500" />
                      却下
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBatchUpdate({ status: "in_progress" })}>
                      <Play className="mr-2 h-4 w-4 text-blue-500" />
                      進行中
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBatchUpdate({ status: "paused" })}>
                      <Pause className="mr-2 h-4 w-4 text-yellow-500" />
                      中断
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBatchUpdate({ status: "completed" })}>
                      <CheckCircle2 className="mr-2 h-4 w-4 text-gray-500" />
                      完了
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* 優先度一括変更 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7" disabled={batchUpdating}>
                      <Signal className="mr-1 h-3 w-3" />
                      優先度
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => handleBatchUpdate({ priority: "high" })}
                      className="text-red-500"
                    >
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      HIGH
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleBatchUpdate({ priority: "medium" })}
                      className="text-yellow-500"
                    >
                      <Signal className="mr-2 h-4 w-4" />
                      MEDIUM
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleBatchUpdate({ priority: "low" })}
                      className="text-green-500"
                    >
                      <Minus className="mr-2 h-4 w-4" />
                      LOW
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleBatchUpdate({ priority: null })}
                      className="text-muted-foreground"
                    >
                      <X className="mr-2 h-4 w-4" />
                      解除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* プロジェクト一括変更 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7" disabled={batchUpdating}>
                      <FolderGit2 className="mr-1 h-3 w-3" />
                      プロジェクト
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {projects.map((project) => (
                      <DropdownMenuItem
                        key={project.id}
                        onClick={() => handleBatchUpdate({ projectId: project.id })}
                      >
                        <FolderGit2 className="mr-2 h-4 w-4" />
                        {project.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      onClick={() => handleBatchUpdate({ projectId: null })}
                      className="text-muted-foreground"
                    >
                      <X className="mr-2 h-4 w-4" />
                      プロジェクト解除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="h-4 w-px bg-border" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={clearSelection}
                  disabled={batchUpdating}
                >
                  選択解除
                </Button>
              </>
            )}
          </div>
        )}

        {/* プロンプト改善案生成 */}
        {promptStats && Object.values(promptStats).some((s) => s.canGenerate) && (
          <div className="rounded-md border bg-muted/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium">プロンプト改善案を生成可能</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(promptStats)
                .filter(([, stat]) => stat.canGenerate)
                .map(([target, stat]) => (
                  <Button
                    key={target}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={generatingImprovement}
                    onClick={async () => {
                      const result = await generateImprovement(target);
                      if (result) {
                        refetchPromptStats();
                        refetch();
                      }
                    }}
                  >
                    {generatingImprovement ? (
                      <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="mr-1 h-3 w-3" />
                    )}
                    {target === "interpret"
                      ? "AI解釈"
                      : target === "evaluate"
                        ? "評価"
                        : target === "summarize-hourly"
                          ? "時間サマリ"
                          : target === "summarize-daily"
                            ? "日次サマリ"
                            : target === "task-extract"
                              ? "タスク抽出"
                              : target}
                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                      {stat.badCount}件
                    </Badge>
                  </Button>
                ))}
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">AIが抽出したタスク候補はありません</p>
            <p className="mt-1 text-xs text-muted-foreground">
              「Extract」をクリックしてSlack/GitHubからタスクを抽出できます
            </p>
          </div>
        ) : (
          <Tabs defaultValue="pending" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="pending" className="flex items-center gap-1">
                <Circle className="h-3 w-3" />
                承認待ち
                {stats.pending > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {stats.pending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="accepted" className="flex items-center gap-1">
                <Check className="h-3 w-3" />
                承認済み
                {stats.accepted > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {stats.accepted}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="in_progress" className="flex items-center gap-1">
                <Play className="h-3 w-3" />
                進行中
                {stats.in_progress > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {stats.in_progress}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="paused" className="flex items-center gap-1">
                <Pause className="h-3 w-3" />
                中断
                {stats.paused > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {stats.paused}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                完了
                {stats.completed > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {stats.completed}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="rejected" className="flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                却下
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="min-h-0 flex-1">
              <TaskList
                tasks={pendingTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                onElaborate={openElaborateDialog}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleSelection={toggleTaskSelection}
                onSelectAll={() => selectAllInTab(pendingTasks)}
              />
            </TabsContent>
            <TabsContent value="accepted" className="min-h-0 flex-1 space-y-2">
              {/* 重複候補パネル */}
              <DuplicateSuggestionsPanel
                duplicates={duplicateSuggestions}
                onMerge={handleMergeDuplicates}
                onDismiss={handleDismissDuplicate}
              />

              {completionSuggestions.length > 0 && (
                <div className="rounded-md border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950">
                  <div className="mb-2 flex items-center gap-1 text-sm font-medium text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-4 w-4" />
                    完了候補 ({completionSuggestions.length}件)
                  </div>
                  <div className="space-y-2">
                    {completionSuggestions.map((suggestion) => (
                      <CompletionSuggestionItem
                        key={suggestion.taskId}
                        suggestion={suggestion}
                        onComplete={() => handleCompleteFromSuggestion(suggestion.taskId)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <TaskList
                tasks={acceptedTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                onElaborate={openElaborateDialog}
                suggestionTaskIds={suggestionTaskIds}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleSelection={toggleTaskSelection}
                onSelectAll={() => selectAllInTab(acceptedTasks)}
              />
            </TabsContent>
            <TabsContent value="in_progress" className="min-h-0 flex-1">
              <TaskList
                tasks={inProgressTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                onElaborate={openElaborateDialog}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleSelection={toggleTaskSelection}
                onSelectAll={() => selectAllInTab(inProgressTasks)}
              />
            </TabsContent>
            <TabsContent value="paused" className="min-h-0 flex-1">
              <TaskList
                tasks={pausedTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                onElaborate={openElaborateDialog}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleSelection={toggleTaskSelection}
                onSelectAll={() => selectAllInTab(pausedTasks)}
              />
            </TabsContent>
            <TabsContent value="completed" className="min-h-0 flex-1">
              <TaskList
                tasks={completedTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleSelection={toggleTaskSelection}
                onSelectAll={() => selectAllInTab(completedTasks)}
              />
            </TabsContent>
            <TabsContent value="rejected" className="min-h-0 flex-1">
              <TaskList
                tasks={rejectedTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleSelection={toggleTaskSelection}
                onSelectAll={() => selectAllInTab(rejectedTasks)}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>

      {/* タスク詳細化ダイアログ */}
      {elaborateTargetTask && (
        <TaskElaborateDialog
          open={elaborateDialogOpen}
          task={elaborateTargetTask}
          project={projects.find((p) => p.id === elaborateTargetTask.projectId) ?? null}
          onElaborate={elaborateTask}
          onApply={handleApplyElaboration}
          onClose={closeElaborateDialog}
        />
      )}
    </Card>
  );
}

function CompletionSuggestionItem({
  suggestion,
  onComplete,
}: {
  suggestion: TaskCompletionSuggestion;
  onComplete: () => void;
}) {
  const getSourceIcon = (source: string) => {
    switch (source) {
      case "github":
        return <Github className="h-3 w-3" />;
      case "claude-code":
        return <Terminal className="h-3 w-3" />;
      case "slack":
        return <MessageSquare className="h-3 w-3" />;
      case "transcribe":
        return <Mic className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "github":
        return "GitHub";
      case "claude-code":
        return "Claude Code";
      case "slack":
        return "Slack";
      case "transcribe":
        return "音声";
      default:
        return source;
    }
  };

  return (
    <div className="flex items-center justify-between rounded bg-white p-2 dark:bg-gray-900">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">{suggestion.task.title}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {getSourceIcon(suggestion.source)}
            {getSourceLabel(suggestion.source)}
          </span>
          <span>・</span>
          <span>{suggestion.reason}</span>
          <span>・</span>
          <span>確信度: {Math.round(suggestion.confidence * 100)}%</span>
        </div>
        {suggestion.evidence && (
          <div className="mt-1 text-xs text-muted-foreground italic">{suggestion.evidence}</div>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onComplete} className="ml-2 gap-1">
        <Check className="h-3 w-3" />
        完了にする
      </Button>
    </div>
  );
}

function TaskList({
  tasks,
  projects,
  onUpdateTask,
  onDeleteTask,
  onElaborate,
  suggestionTaskIds,
  selectionMode = false,
  selectedTaskIds,
  onToggleSelection,
  onSelectAll,
}: {
  tasks: Task[];
  projects: Project[];
  onUpdateTask: (
    id: number,
    updates: {
      status?: TaskStatus;
      rejectReason?: string;
      title?: string;
      description?: string;
      priority?: "high" | "medium" | "low" | null;
      projectId?: number | null;
    },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  onElaborate?: (task: Task) => void;
  suggestionTaskIds?: Set<number>;
  selectionMode?: boolean;
  selectedTaskIds?: Set<number>;
  onToggleSelection?: (taskId: number) => void;
  onSelectAll?: () => void;
}) {
  if (tasks.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">タスクはありません</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 選択モード時の全選択ボタン */}
      {selectionMode && onSelectAll && (
        <div className="mb-2 flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={onSelectAll}>
            <CheckSquare className="mr-1 h-3 w-3" />
            このタブを全選択 ({tasks.length})
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            projects={projects}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            onElaborate={onElaborate}
            isSuggested={suggestionTaskIds?.has(task.id)}
            selectionMode={selectionMode}
            isSelected={selectedTaskIds?.has(task.id) ?? false}
            onToggleSelection={onToggleSelection}
          />
        ))}
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex task item UI
function TaskItem({
  task,
  projects,
  onUpdateTask,
  onDeleteTask,
  onElaborate,
  isSuggested,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: {
  task: Task;
  projects: Project[];
  onUpdateTask: (
    id: number,
    updates: {
      status?: TaskStatus;
      rejectReason?: string;
      title?: string;
      description?: string;
      priority?: "high" | "medium" | "low" | null;
      projectId?: number | null;
    },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  onElaborate?: (task: Task) => void;
  isSuggested?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (taskId: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState<"edit" | "edit-approve">("edit");
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description ?? "");
  // インライン編集モード
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineDescription, setInlineDescription] = useState(task.description ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // コピー状態
  const [copied, setCopied] = useState(false);
  // プロンプト改善の差分表示
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const { improvement } = usePromptImprovement(
    diffDialogOpen && task.promptImprovementId ? task.promptImprovementId : null,
  );

  const projectName = getProjectName(projects, task.projectId);

  const handleReject = async () => {
    await onUpdateTask(task.id, { status: "rejected", rejectReason: rejectReason || undefined });
    setRejectDialogOpen(false);
    setRejectReason("");
  };

  const handleEditSave = async () => {
    const updates: { status?: TaskStatus; title?: string; description?: string } = {
      title: editTitle,
      description: editDescription || undefined,
    };
    // 「修正して承認」モードの場合のみステータスを更新
    if (editMode === "edit-approve") {
      updates.status = "accepted";
    }
    await onUpdateTask(task.id, updates);
    setEditDialogOpen(false);
  };

  const openEditDialog = (mode: "edit" | "edit-approve") => {
    setEditMode(mode);
    setEditTitle(task.title);
    setEditDescription(task.description ?? "");
    setEditDialogOpen(true);
  };

  // インライン編集
  const startInlineEdit = () => {
    setInlineDescription(task.description ?? "");
    setInlineEditing(true);
    // フォーカスを当てる (次のレンダリング後)
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const saveInlineEdit = async () => {
    await onUpdateTask(task.id, { description: inlineDescription || undefined });
    setInlineEditing(false);
  };

  const cancelInlineEdit = () => {
    setInlineDescription(task.description ?? "");
    setInlineEditing(false);
  };

  // クリップボードにコピー (AIに渡す用)
  const copyToClipboard = async () => {
    let text = `## ${task.title}`;
    if (task.description) {
      text += `\n\n${task.description}`;
    }

    // ステータスに応じたアクションコマンドを生成
    const baseUrl = ADAS_API_URL;
    const startUrl = `${baseUrl}/api/tasks/${task.id}/start`;
    const completeUrl = `${baseUrl}/api/tasks/${task.id}/complete`;
    const pauseUrl = `${baseUrl}/api/tasks/${task.id}/pause`;

    if (task.status === "accepted") {
      // 承認済み: 開始 → 完了/中断
      text += "\n\n---\n";
      text += "作業開始前に以下を実行してください:\n";
      text += "```bash\n";
      text += `curl -X POST ${startUrl}\n`;
      text += "```\n\n";
      text += "タスク完了時は以下を実行してください:\n";
      text += "```bash\n";
      text += `curl -X POST ${completeUrl}\n`;
      text += "```\n\n";
      text += "中断する場合は、中断理由を確認してから以下を実行してください:\n";
      text += "```bash\n";
      text += `curl -X POST ${pauseUrl} -H "Content-Type: application/json" -d '{"reason": "中断理由をここに記入"}'\n`;
      text += "```";
    } else if (task.status === "in_progress") {
      // 進行中: 完了/中断
      text += "\n\n---\n";
      text += "タスク完了時は以下を実行してください:\n";
      text += "```bash\n";
      text += `curl -X POST ${completeUrl}\n`;
      text += "```\n\n";
      text += "中断する場合は、中断理由を確認してから以下を実行してください:\n";
      text += "```bash\n";
      text += `curl -X POST ${pauseUrl} -H "Content-Type: application/json" -d '{"reason": "中断理由をここに記入"}'\n`;
      text += "```";
    } else if (task.status === "paused") {
      // 中断: 再開 → 完了
      text += "\n\n---\n";
      text += "作業再開時は以下を実行してください:\n";
      text += "```bash\n";
      text += `curl -X POST ${startUrl}\n`;
      text += "```\n\n";
      text += "タスク完了時は以下を実行してください:\n";
      text += "```bash\n";
      text += `curl -X POST ${completeUrl}\n`;
      text += "```";
    }
    // pending, completed, rejected はアクションコマンドなし

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className={`rounded-md border p-3 ${getTaskStyle(task, isSelected, isSuggested)}`}>
          {/* ヘッダー: タイトル + ソースバッジ */}
          <CollapsibleTrigger className="flex w-full items-start justify-between text-left">
            {/* 選択モード時のチェックボックス */}
            {selectionMode && (
              <button
                type="button"
                className="mr-2 flex-shrink-0 p-0.5 rounded hover:bg-muted/50 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelection?.(task.id);
                }}
              >
                {isSelected ? (
                  <CheckSquare className="h-5 w-5 text-blue-500" />
                ) : (
                  <Square className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
            )}
            <div className="flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-medium">{task.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditDialog("edit");
                  }}
                  className="p-0.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                  title="編集"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {task.sourceType === "slack" && (
                  <Badge variant="secondary" className="text-xs">
                    Slack
                  </Badge>
                )}
                {task.sourceType === "github" && (
                  <Badge variant="secondary" className="text-xs">
                    GitHub
                  </Badge>
                )}
                {task.sourceType === "github-comment" && (
                  <Badge variant="secondary" className="text-xs">
                    GitHub Comment
                  </Badge>
                )}
                {task.sourceType === "memo" && (
                  <Badge variant="secondary" className="text-xs">
                    Memo
                  </Badge>
                )}
                {task.sourceType === "prompt-improvement" && (
                  <Badge variant="default" className="text-xs bg-purple-500">
                    <Wand2 className="mr-1 h-3 w-3" />
                    改善
                  </Badge>
                )}
                {task.sourceType === "vocabulary" && (
                  <Badge variant="default" className="text-xs bg-teal-500">
                    <BookOpen className="mr-1 h-3 w-3" />
                    用語
                  </Badge>
                )}
                {task.sourceType === "merge" && (
                  <Badge variant="default" className="text-xs bg-amber-500">
                    <GitMerge className="mr-1 h-3 w-3" />
                    統合
                  </Badge>
                )}
              </div>
              {task.dueDate && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs">
                    Due: {task.dueDate}
                  </Badge>
                </div>
              )}
            </div>
            <ChevronDown
              className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>

          {/* アクションボタン - 常に表示 */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* 優先度変更 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 ${task.priority === "high" ? "text-red-500 border-red-200" : task.priority === "medium" ? "text-yellow-500 border-yellow-200" : task.priority === "low" ? "text-green-500 border-green-200" : ""}`}
                >
                  {task.priority === "high" ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : task.priority === "medium" ? (
                    <Signal className="h-3 w-3" />
                  ) : task.priority === "low" ? (
                    <Minus className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  {task.priority ? task.priority.toUpperCase() : "優先度"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => onUpdateTask(task.id, { priority: "high" })}
                  className="text-red-500"
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  HIGH - 高優先度
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onUpdateTask(task.id, { priority: "medium" })}
                  className="text-yellow-500"
                >
                  <Signal className="mr-2 h-4 w-4" />
                  MEDIUM - 中優先度
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onUpdateTask(task.id, { priority: "low" })}
                  className="text-green-500"
                >
                  <Minus className="mr-2 h-4 w-4" />
                  LOW - 低優先度
                </DropdownMenuItem>
                {task.priority && (
                  <DropdownMenuItem
                    onClick={() => onUpdateTask(task.id, { priority: null })}
                    className="text-muted-foreground"
                  >
                    <X className="mr-2 h-4 w-4" />
                    優先度を解除
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* プロジェクト変更 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 ${projectName ? "text-blue-500 border-blue-200" : ""}`}
                >
                  <FolderGit2 className="h-3 w-3" />
                  {projectName || "プロジェクト"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => onUpdateTask(task.id, { projectId: project.id })}
                    className={task.projectId === project.id ? "bg-accent" : ""}
                  >
                    <FolderGit2 className="mr-2 h-4 w-4" />
                    {project.name}
                  </DropdownMenuItem>
                ))}
                {task.projectId && (
                  <DropdownMenuItem
                    onClick={() => onUpdateTask(task.id, { projectId: null })}
                    className="text-muted-foreground"
                  >
                    <X className="mr-2 h-4 w-4" />
                    プロジェクト解除
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 承認・修正して承認・却下ボタン (承認待ちのみ) */}
            {task.status === "pending" && (
              <>
                {/* プロンプト改善タスクの場合は差分ボタンを表示 */}
                {task.sourceType === "prompt-improvement" && task.promptImprovementId && (
                  <Button variant="outline" size="sm" onClick={() => setDiffDialogOpen(true)}>
                    <FileText className="mr-1 h-3 w-3" />
                    差分
                  </Button>
                )}
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onUpdateTask(task.id, { status: "accepted" })}
                >
                  <Check className="mr-1 h-3 w-3" />
                  承認
                </Button>
                {/* 承認のみタスク以外は「修正して承認」を表示 */}
                {!isApprovalOnlyTask(task.sourceType) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditDialog("edit-approve")}
                  >
                    <Wand2 className="mr-1 h-3 w-3" />
                    修正して承認
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setRejectDialogOpen(true)}>
                  <X className="mr-1 h-3 w-3" />
                  却下
                </Button>
              </>
            )}

            {/* 進行状態プルダウン (承認済み以降のみ、承認のみタスクは除く) */}
            {task.status !== "pending" &&
              task.status !== "rejected" &&
              !isApprovalOnlyTask(task.sourceType) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`gap-1 ${
                        task.status === "accepted"
                          ? ""
                          : task.status === "in_progress"
                            ? "border-green-200 text-green-600"
                            : task.status === "paused"
                              ? "border-yellow-200 text-yellow-600"
                              : "border-gray-200 text-gray-600"
                      }`}
                    >
                      {task.status === "accepted" && <Circle className="h-3 w-3" />}
                      {task.status === "in_progress" && <Play className="h-3 w-3" />}
                      {task.status === "paused" && <Pause className="h-3 w-3" />}
                      {task.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
                      {task.status === "accepted" && "未着手"}
                      {task.status === "in_progress" && "進行中"}
                      {task.status === "paused" && "中断"}
                      {task.status === "completed" && "完了"}
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => onUpdateTask(task.id, { status: "accepted" })}
                      className={task.status === "accepted" ? "bg-accent" : ""}
                    >
                      <Circle className="mr-2 h-4 w-4" />
                      未着手
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onUpdateTask(task.id, { status: "in_progress" })}
                      className={task.status === "in_progress" ? "bg-accent" : ""}
                    >
                      <Play className="mr-2 h-4 w-4 text-green-500" />
                      進行中
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onUpdateTask(task.id, { status: "paused" })}
                      className={task.status === "paused" ? "bg-accent" : ""}
                    >
                      <Pause className="mr-2 h-4 w-4 text-yellow-500" />
                      中断
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onUpdateTask(task.id, { status: "completed" })}
                      className={task.status === "completed" ? "bg-accent" : ""}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4 text-gray-500" />
                      完了
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

            {/* 補助アクション */}
            {/* 詳細化ボタン (承認のみタスク以外で表示) */}
            {onElaborate && !isApprovalOnlyTask(task.sourceType) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onElaborate(task)}
                title="AI でタスクを詳細化"
              >
                <Wand2 className="mr-1 h-3 w-3" />
                詳細化
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={copyToClipboard}>
              {copied ? (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  コピー済み
                </>
              ) : (
                <>
                  <ClipboardCopy className="mr-1 h-3 w-3" />
                  AIに渡す
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => onDeleteTask(task.id)}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              削除
            </Button>
          </div>

          {/* 詳細 (展開時のみ) */}
          <CollapsibleContent className="mt-3 space-y-3">
            {/* 詳細: インライン編集 or マークダウン表示 */}
            {inlineEditing ? (
              <div className="space-y-2">
                <Textarea
                  ref={textareaRef}
                  value={inlineDescription}
                  onChange={(e) => setInlineDescription(e.target.value)}
                  placeholder="詳細を入力... (Markdown 対応)"
                  rows={5}
                  className="text-sm"
                  onKeyDown={(e) => {
                    // Cmd/Ctrl + Enter で保存
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      saveInlineEdit();
                    }
                    // Escape でキャンセル
                    if (e.key === "Escape") {
                      cancelInlineEdit();
                    }
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={saveInlineEdit}>
                    <Check className="mr-1 h-3 w-3" />
                    保存
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelInlineEdit}>
                    キャンセル
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Cmd+Enter で保存 / Esc でキャンセル
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={startInlineEdit}
                className="w-full cursor-pointer rounded-md border border-transparent p-2 -m-2 text-left hover:border-muted-foreground/20 hover:bg-muted/50 transition-colors"
                title="クリックして編集"
              >
                {task.description ? (
                  <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
                    <Markdown remarkPlugins={[remarkGfm]}>{task.description}</Markdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/50 italic">
                    クリックして詳細を追加...
                  </p>
                )}
              </button>
            )}
            {task.rejectReason && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">却下理由:</span> {task.rejectReason}
              </p>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>タスク候補を却下</DialogTitle>
            <DialogDescription>
              このタスク候補を却下する理由を教えてください。AIの抽出精度向上に役立ちます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm font-medium">{task.title}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reject-reason">理由 (任意)</Label>
              <Textarea
                id="reject-reason"
                placeholder="例: タスクではない、既に完了済み、誤った解釈..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleReject}>
              却下
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 編集ダイアログ */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editMode === "edit-approve" ? "タスクを修正して承認" : "タスクを編集"}
            </DialogTitle>
            <DialogDescription>
              {editMode === "edit-approve"
                ? "タスクの内容を修正してから承認できます。修正内容はAIの学習に活用されます。"
                : "タスクの内容を編集できます。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">タイトル</Label>
              <input
                id="edit-title"
                type="text"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">詳細</Label>
              <Textarea
                id="edit-description"
                placeholder="タスクの詳細説明..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleEditSave} disabled={!editTitle.trim()}>
              {editMode === "edit-approve" ? (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  修正して承認
                </>
              ) : (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  保存
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* プロンプト改善差分ダイアログ */}
      <Dialog open={diffDialogOpen} onOpenChange={setDiffDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>プロンプト改善案の差分</DialogTitle>
            <DialogDescription>{improvement?.improvementReason}</DialogDescription>
          </DialogHeader>
          {improvement ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="mb-2 text-sm font-medium">変更前</h4>
                <ScrollArea className="h-[400px] rounded border p-2">
                  <pre className="whitespace-pre-wrap text-xs">{improvement.previousPrompt}</pre>
                </ScrollArea>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium">変更後</h4>
                <ScrollArea className="h-[400px] rounded border p-2">
                  <pre className="whitespace-pre-wrap text-xs">{improvement.newPrompt}</pre>
                </ScrollArea>
              </div>
            </div>
          ) : (
            <div className="flex h-[400px] items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffDialogOpen(false)}>
              閉じる
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onUpdateTask(task.id, { status: "rejected" });
                setDiffDialogOpen(false);
              }}
            >
              <X className="mr-1 h-4 w-4" />
              却下
            </Button>
            <Button
              onClick={() => {
                onUpdateTask(task.id, { status: "accepted" });
                setDiffDialogOpen(false);
              }}
            >
              <Check className="mr-1 h-4 w-4" />
              承認
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
