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
  type VocabularySuggestionSourceType,
  WORK_TYPE_LABELS,
  type WorkType,
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
  Circle,
  ClipboardCopy,
  FileText,
  Filter,
  FolderGit2,
  FolderKanban,
  Github,
  GitMerge,
  ListTree,
  Loader2,
  MessageSquare,
  MessageSquareMore,
  Mic,
  Minus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Signal,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { BulkElaborateDialog } from "./bulk-elaborate-dialog";
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

/** ステータスフィルターの設定 */
const STATUS_FILTER_CONFIG: {
  status: TaskStatus;
  label: string;
  icon: typeof Circle;
  activeClass: string;
}[] = [
  {
    status: "pending",
    label: "承認待ち",
    icon: Circle,
    activeClass:
      "bg-orange-100 border-orange-400 text-orange-700 dark:bg-orange-950 dark:border-orange-600 dark:text-orange-300",
  },
  {
    status: "accepted",
    label: "承認済み",
    icon: Check,
    activeClass:
      "bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-950 dark:border-blue-600 dark:text-blue-300",
  },
  {
    status: "in_progress",
    label: "進行中",
    icon: Play,
    activeClass:
      "bg-green-100 border-green-400 text-green-700 dark:bg-green-950 dark:border-green-600 dark:text-green-300",
  },
  {
    status: "paused",
    label: "中断",
    icon: Pause,
    activeClass:
      "bg-yellow-100 border-yellow-400 text-yellow-700 dark:bg-yellow-950 dark:border-yellow-600 dark:text-yellow-300",
  },
  {
    status: "completed",
    label: "完了",
    icon: CheckCircle2,
    activeClass:
      "bg-gray-100 border-gray-400 text-gray-700 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300",
  },
  {
    status: "rejected",
    label: "却下",
    icon: XCircle,
    activeClass:
      "bg-red-100 border-red-400 text-red-700 dark:bg-red-950 dark:border-red-600 dark:text-red-300",
  },
];

/** 用語提案ソースタイプのラベルマップ */
const VOCABULARY_SOURCE_LABELS: Record<VocabularySuggestionSourceType, string> = {
  interpret: "音声",
  feedback: "フィードバック",
  slack: "Slack",
  github: "GitHub",
  "claude-code": "Claude Code",
  memo: "メモ",
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
    // 非同期詳細化 API
    startElaborate,
    getElaborationStatus,
    applyElaboration,
    discardElaboration,
    // 一括詳細化 (非同期)
    startBulkElaborate,
    getBulkElaborationStatus,
    // 重複チェック
    checkSimilarityBatch,
    // GitHub Issue 作成
    createGitHubIssue,
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
  const { permission, requestPermission } = useNotifications();
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

  // 重複チェック
  const [checkingSimilarity, setCheckingSimilarity] = useState(false);

  // ステータスフィルター (単一選択)
  const [statusFilter, setStatusFilter] = useState<TaskStatus>("pending");

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

  // 一括詳細化ダイアログ
  const [bulkElaborateDialogOpen, setBulkElaborateDialogOpen] = useState(false);

  const closeBulkElaborateDialog = () => {
    setBulkElaborateDialogOpen(false);
  };

  // GitHub Issue 作成
  const [creatingIssue, setCreatingIssue] = useState(false);

  const handleCreateIssue = async (task: Task) => {
    if (creatingIssue) return;
    setCreatingIssue(true);
    try {
      const result = await createGitHubIssue(task.id);
      toast.success(`GitHub Issue を作成しました: #${result.issueNumber}`, {
        description: (
          <a
            href={result.issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Issue を開く
          </a>
        ),
      });
    } catch (err) {
      toast.error("Issue 作成に失敗しました", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreatingIssue(false);
    }
  };

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

  // 非同期版: ジョブをキューに登録 (結果はSSE通知で受け取る)
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

  // 重複チェック (pending の類似チェック + accepted の重複検出)
  const handleBulkDuplicateCheck = async () => {
    setDetectingDuplicates(true);
    setCheckingSimilarity(true);
    setDuplicateSuggestions([]);
    try {
      // 両方を並列実行
      const [similarityResult, duplicatesResult] = await Promise.all([
        checkSimilarityBatch({ date }),
        detectDuplicates({ date }),
      ]);
      setDuplicateSuggestions(duplicatesResult.duplicates);

      // 結果を通知
      const duplicateCount = duplicatesResult.duplicates.length;
      const similarCount = similarityResult.updated;

      if (duplicateCount > 0 || similarCount > 0) {
        const messages: string[] = [];
        if (duplicateCount > 0) {
          messages.push(`重複候補 ${duplicateCount}件`);
        }
        if (similarCount > 0) {
          messages.push(`類似タスク ${similarCount}件`);
        }
        toast.success(`チェック完了: ${messages.join("、")}`, {
          description: duplicateCount > 0 ? "「承認済み」タブで重複候補を確認できます" : undefined,
        });

        // 重複が見つかった場合は「承認済み」タブに切り替え
        if (duplicateCount > 0) {
          setActiveTab("accepted");
        }
      } else {
        toast.info("重複・類似タスクは見つかりませんでした");
      }
    } catch (err) {
      console.error("Failed to check duplicates:", err);
      toast.error("重複チェックに失敗しました");
    } finally {
      setDetectingDuplicates(false);
      setCheckingSimilarity(false);
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

  const toggleSelectAll = (taskList: Task[]) => {
    const taskIds = taskList.map((t) => t.id);
    const allSelected = taskIds.every((id) => selectedTaskIds.has(id));
    if (allSelected) {
      // 全解除
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        for (const id of taskIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      // 全選択
      setSelectedTaskIds((prev) => new Set([...prev, ...taskIds]));
    }
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

  // ステータスフィルターの選択
  const selectStatusFilter = (status: TaskStatus) => {
    setStatusFilter(status);
  };

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

  // 選択されたステータスでフィルタリング
  const filteredTasksByStatus = (() => {
    switch (statusFilter) {
      case "pending":
        return pendingTasks;
      case "accepted":
        return acceptedTasks;
      case "in_progress":
        return inProgressTasks;
      case "paused":
        return pausedTasks;
      case "completed":
        return completedTasks;
      case "rejected":
        return rejectedTasks;
      default:
        return [];
    }
  })();

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
            {/* 編集モードトグル */}
            <Button
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
              title={selectionMode ? "編集モードを終了" : "編集モードを開始"}
            >
              {selectionMode ? (
                <>
                  <X className="mr-1 h-3 w-3" />
                  終了
                </>
              ) : (
                <>
                  <CheckSquare className="mr-1 h-3 w-3" />
                  編集
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
        {/* Filters */}
        {tasks.length > 0 && (
          <div className="mb-3 flex shrink-0 items-center gap-2">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {/* Source Filter */}
            <Select
              value={sourceFilter}
              onValueChange={(value) => setSourceFilter(value as TaskSourceType | "all")}
            >
              <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs">
                <SelectValue placeholder="ソース" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全て ({sourceCount.all})</SelectItem>
                {sourceCount.slack > 0 && (
                  <SelectItem value="slack">Slack ({sourceCount.slack})</SelectItem>
                )}
                {sourceCount.github > 0 && (
                  <SelectItem value="github">GitHub ({sourceCount.github})</SelectItem>
                )}
                {sourceCount["prompt-improvement"] > 0 && (
                  <SelectItem value="prompt-improvement">
                    改善 ({sourceCount["prompt-improvement"]})
                  </SelectItem>
                )}
                {sourceCount.memo > 0 && (
                  <SelectItem value="memo">Memo ({sourceCount.memo})</SelectItem>
                )}
                {sourceCount.vocabulary > 0 && (
                  <SelectItem value="vocabulary">用語 ({sourceCount.vocabulary})</SelectItem>
                )}
              </SelectContent>
            </Select>
            {/* Project Filter */}
            {projectsWithTasks.length > 0 && (
              <Select
                value={String(projectFilter)}
                onValueChange={(value) => {
                  if (value === "all" || value === "none") {
                    setProjectFilter(value);
                  } else {
                    setProjectFilter(Number(value));
                  }
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs">
                  <SelectValue placeholder="プロジェクト" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全プロジェクト</SelectItem>
                  {projectsWithTasks.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name} ({projectCount.get(project.id) ?? 0})
                    </SelectItem>
                  ))}
                  {(projectCount.get("none") ?? 0) > 0 && (
                    <SelectItem value="none">未分類 ({projectCount.get("none")})</SelectItem>
                  )}
                </SelectContent>
              </Select>
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
                        : target === "summarize-times"
                          ? "時間範囲サマリ"
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
          <div className="flex min-h-0 flex-1 flex-col">
            {/* ステータスフィルター */}
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">表示:</span>
              {STATUS_FILTER_CONFIG.map(({ status, label, icon: Icon, activeClass }) => {
                const isActive = statusFilter === status;
                const count = stats[status] ?? 0;
                return (
                  <button
                    type="button"
                    key={status}
                    onClick={() => selectStatusFilter(status)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? activeClass
                        : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                    {count > 0 && (
                      <span className={`ml-0.5 ${isActive ? "" : "opacity-60"}`}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 編集モードバー */}
            {selectionMode && (
              <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-blue-50 p-2 dark:bg-blue-950">
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
                    {/* ステータス変更 */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          disabled={batchUpdating}
                        >
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
                        <DropdownMenuItem
                          onClick={() => handleBatchUpdate({ status: "in_progress" })}
                        >
                          <Play className="mr-2 h-4 w-4 text-blue-500" />
                          進行中
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleBatchUpdate({ status: "paused" })}>
                          <Pause className="mr-2 h-4 w-4 text-yellow-500" />
                          中断
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleBatchUpdate({ status: "completed" })}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4 text-gray-500" />
                          完了
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* 優先度変更 */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          disabled={batchUpdating}
                        >
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
                    {/* プロジェクト変更 */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          disabled={batchUpdating}
                        >
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
                    {/* 詳細化 */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() => setBulkElaborateDialogOpen(true)}
                      disabled={
                        batchUpdating || selectedTaskIds.size === 0 || selectedTaskIds.size > 10
                      }
                      title={
                        selectedTaskIds.size > 10
                          ? "最大10件まで選択可能"
                          : "選択したタスクを AI 詳細化"
                      }
                    >
                      <Wand2 className="mr-1 h-3 w-3" />
                      詳細化
                    </Button>
                    <div className="h-4 w-px bg-border" />
                    {/* 完了チェック */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={handleCheckCompletions}
                      disabled={checkingCompletion}
                      title="完了チェック"
                    >
                      <Search
                        className={`mr-1 h-3 w-3 ${checkingCompletion ? "animate-pulse" : ""}`}
                      />
                      {checkingCompletion ? "チェック中..." : "完了チェック"}
                    </Button>
                    {/* 重複チェック */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={handleBulkDuplicateCheck}
                      disabled={detectingDuplicates || checkingSimilarity}
                      title="重複チェック"
                    >
                      <Search
                        className={`mr-1 h-3 w-3 ${detectingDuplicates || checkingSimilarity ? "animate-pulse" : ""}`}
                      />
                      {detectingDuplicates || checkingSimilarity ? "チェック中..." : "重複チェック"}
                    </Button>
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

            {/* 特殊パネル (acceptedフィルターが有効な場合のみ表示) */}
            {statusFilter === "accepted" && (
              <div className="space-y-2">
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
              </div>
            )}

            {/* タスクリスト */}
            <TaskList
              tasks={filteredTasksByStatus}
              projects={projects}
              allTasks={tasks}
              onUpdateTask={updateTask}
              onDeleteTask={deleteTask}
              onElaborate={openElaborateDialog}
              onCreateIssue={handleCreateIssue}
              suggestionTaskIds={suggestionTaskIds}
              selectionMode={selectionMode}
              selectedTaskIds={selectedTaskIds}
              onToggleSelection={toggleTaskSelection}
              onToggleSelectAll={() => toggleSelectAll(filteredTasksByStatus)}
              allSelected={
                filteredTasksByStatus.length > 0 &&
                filteredTasksByStatus.every((t) => selectedTaskIds.has(t.id))
              }
            />
          </div>
        )}
      </CardContent>

      {/* タスク詳細化ダイアログ */}
      {elaborateTargetTask && (
        <TaskElaborateDialog
          open={elaborateDialogOpen}
          task={elaborateTargetTask}
          project={projects.find((p) => p.id === elaborateTargetTask.projectId) ?? null}
          onStartElaborate={startElaborate}
          onGetElaborationStatus={getElaborationStatus}
          onApplyElaboration={applyElaboration}
          onDiscardElaboration={discardElaboration}
          onClose={closeElaborateDialog}
        />
      )}

      {/* 一括詳細化ダイアログ */}
      <BulkElaborateDialog
        open={bulkElaborateDialogOpen}
        tasks={tasks.filter((t) => selectedTaskIds.has(t.id))}
        projects={projects}
        onStartBulkElaborate={startBulkElaborate}
        onGetBulkElaborationStatus={getBulkElaborationStatus}
        onApplyElaboration={applyElaboration}
        onRefetch={() => refetch(true)}
        onClose={closeBulkElaborateDialog}
      />
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
  allTasks,
  onUpdateTask,
  onDeleteTask,
  onElaborate,
  onCreateIssue,
  suggestionTaskIds,
  selectionMode = false,
  selectedTaskIds,
  onToggleSelection,
  onToggleSelectAll,
  allSelected = false,
}: {
  tasks: Task[];
  projects: Project[];
  /** 全タスク (子タスク・親タスク情報の取得用、TaskItem に渡される) */
  allTasks?: Task[];
  onUpdateTask: (
    id: number,
    updates: {
      status?: TaskStatus;
      rejectReason?: string;
      title?: string;
      description?: string;
      priority?: "high" | "medium" | "low" | null;
      workType?: WorkType | null;
      projectId?: number | null;
    },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  onElaborate?: (task: Task) => void;
  onCreateIssue?: (task: Task) => Promise<void>;
  suggestionTaskIds?: Set<number>;
  selectionMode?: boolean;
  selectedTaskIds?: Set<number>;
  onToggleSelection?: (taskId: number) => void;
  onToggleSelectAll?: () => void;
  allSelected?: boolean;
}) {
  if (tasks.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">タスクはありません</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 選択モード時のヘッダー行 */}
      {selectionMode && tasks.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded p-1 hover:bg-muted/50"
            onClick={onToggleSelectAll}
          >
            {allSelected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            <span>{allSelected ? "全解除" : "全選択"}</span>
          </button>
        </div>
      )}
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            projects={projects}
            allTasks={allTasks}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            onElaborate={onElaborate}
            onCreateIssue={onCreateIssue}
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
  allTasks,
  onUpdateTask,
  onDeleteTask,
  onElaborate,
  onCreateIssue,
  isSuggested,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: {
  task: Task;
  projects: Project[];
  /** 全タスク (子タスク・親タスク情報の取得用) */
  allTasks?: Task[];
  onUpdateTask: (
    id: number,
    updates: {
      status?: TaskStatus;
      rejectReason?: string;
      title?: string;
      description?: string;
      priority?: "high" | "medium" | "low" | null;
      workType?: WorkType | null;
      projectId?: number | null;
    },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  onElaborate?: (task: Task) => void;
  onCreateIssue?: (task: Task) => Promise<void>;
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
  // シンプルコピー状態 (タスク情報のみ)
  const [simpleCopied, setSimpleCopied] = useState(false);
  // Claude に送信中フラグ
  const [sendingToClaude, setSendingToClaude] = useState(false);
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

  // Cmd+Enter (Mac) / Ctrl+Enter (Windows) で却下を実行
  useEffect(() => {
    if (!rejectDialogOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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

  // シンプルコピー (タスク情報のみ)
  const simpleCopyToClipboard = async () => {
    let text = `## ${task.title}`;
    if (task.description) {
      text += `\n\n${task.description}`;
    }

    // 子タスク情報を追加 (親タスクの場合)
    if (allTasks && task.parentId === null) {
      const childTasks = allTasks
        .filter((t) => t.parentId === task.id)
        .sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0));
      if (childTasks.length > 0) {
        text += `\n\n### 子タスク (${childTasks.length}件)\n`;
        for (const child of childTasks) {
          text += `${child.stepNumber ?? 0}. [${child.status}] ${child.title}\n`;
        }
      }
    }

    // 親タスク情報を追加 (子タスクの場合)
    if (allTasks && task.parentId !== null) {
      const parentTask = allTasks.find((t) => t.id === task.parentId);
      if (parentTask) {
        text += `\n\n### 親タスク\n- #${parentTask.id} ${parentTask.title}`;
      }
    }

    await navigator.clipboard.writeText(text);
    setSimpleCopied(true);
    setTimeout(() => setSimpleCopied(false), 2000);
  };

  // クリップボードにコピー (タスク情報 + API コマンド)
  const copyToClipboard = async () => {
    let text = `## ${task.title}`;
    if (task.description) {
      text += `\n\n${task.description}`;
    }

    // 子タスク情報を追加 (親タスクの場合)
    if (allTasks && task.parentId === null) {
      const childTasks = allTasks
        .filter((t) => t.parentId === task.id)
        .sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0));
      if (childTasks.length > 0) {
        text += `\n\n### 子タスク (${childTasks.length}件)\n`;
        for (const child of childTasks) {
          text += `${child.stepNumber ?? 0}. [${child.status}] ${child.title}\n`;
        }
      }
    }

    // 親タスク情報を追加 (子タスクの場合)
    if (allTasks && task.parentId !== null) {
      const parentTask = allTasks.find((t) => t.id === task.parentId);
      if (parentTask) {
        text += `\n\n### 親タスク\n- #${parentTask.id} ${parentTask.title}`;
      }
    }

    // タスク更新API
    const baseUrl = ADAS_API_URL;
    const updateUrl = `${baseUrl}/api/tasks/${task.id}`;
    text += "\n\n---\n";
    text += "### タスク更新API\n";
    text += "タイトルや説明を変更する場合:\n";
    text += "```bash\n";
    text += `curl -X PATCH ${updateUrl} -H "Content-Type: application/json" -d '{"title": "新しいタイトル", "description": "新しい説明"}'\n`;
    text += "```\n";
    text +=
      "更新可能なフィールド: `title`, `description`, `priority` (high/medium/low), `workType`, `dueDate`, `projectId`\n";

    // ステータスに応じたアクションコマンドを生成
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

  // Claude Code にタスク情報を送信
  const sendToClaude = async () => {
    if (sendingToClaude) return;

    let prompt = `## ${task.title}`;
    if (task.description) {
      prompt += `\n\n${task.description}`;
    }

    // 子タスク情報を追加 (親タスクの場合)
    if (allTasks && task.parentId === null) {
      const childTasks = allTasks
        .filter((t) => t.parentId === task.id)
        .sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0));
      if (childTasks.length > 0) {
        prompt += `\n\n### 子タスク (${childTasks.length}件)\n`;
        for (const child of childTasks) {
          prompt += `${child.stepNumber ?? 0}. [${child.status}] ${child.title}\n`;
        }
      }
    }

    // 親タスク情報を追加 (子タスクの場合)
    if (allTasks && task.parentId !== null) {
      const parentTask = allTasks.find((t) => t.id === task.parentId);
      if (parentTask) {
        prompt += `\n\n### 親タスク\n- #${parentTask.id} ${parentTask.title}`;
      }
    }

    // タスク更新API
    const baseUrl = ADAS_API_URL;
    const updateUrl = `${baseUrl}/api/tasks/${task.id}`;
    prompt += "\n\n---\n";
    prompt += "### タスク更新API\n";
    prompt += "タイトルや説明を変更する場合:\n";
    prompt += "```bash\n";
    prompt += `curl -X PATCH ${updateUrl} -H "Content-Type: application/json" -d '{"title": "新しいタイトル", "description": "新しい説明"}'\n`;
    prompt += "```\n";
    prompt +=
      "更新可能なフィールド: `title`, `description`, `priority` (high/medium/low), `workType`, `dueDate`, `projectId`\n";

    // ステータスに応じたアクションコマンドを生成
    const startUrl = `${baseUrl}/api/tasks/${task.id}/start`;
    const completeUrl = `${baseUrl}/api/tasks/${task.id}/complete`;
    const pauseUrl = `${baseUrl}/api/tasks/${task.id}/pause`;

    if (task.status === "accepted") {
      prompt += "\n\n---\n";
      prompt += "作業開始前に以下を実行してください:\n";
      prompt += "```bash\n";
      prompt += `curl -X POST ${startUrl}\n`;
      prompt += "```\n\n";
      prompt += "タスク完了時は以下を実行してください:\n";
      prompt += "```bash\n";
      prompt += `curl -X POST ${completeUrl}\n`;
      prompt += "```\n\n";
      prompt += "中断する場合は、中断理由を確認してから以下を実行してください:\n";
      prompt += "```bash\n";
      prompt += `curl -X POST ${pauseUrl} -H "Content-Type: application/json" -d '{"reason": "中断理由をここに記入"}'\n`;
      prompt += "```";
    } else if (task.status === "in_progress") {
      prompt += "\n\n---\n";
      prompt += "タスク完了時は以下を実行してください:\n";
      prompt += "```bash\n";
      prompt += `curl -X POST ${completeUrl}\n`;
      prompt += "```\n\n";
      prompt += "中断する場合は、中断理由を確認してから以下を実行してください:\n";
      prompt += "```bash\n";
      prompt += `curl -X POST ${pauseUrl} -H "Content-Type: application/json" -d '{"reason": "中断理由をここに記入"}'\n`;
      prompt += "```";
    } else if (task.status === "paused") {
      prompt += "\n\n---\n";
      prompt += "作業再開時は以下を実行してください:\n";
      prompt += "```bash\n";
      prompt += `curl -X POST ${startUrl}\n`;
      prompt += "```\n\n";
      prompt += "タスク完了時は以下を実行してください:\n";
      prompt += "```bash\n";
      prompt += `curl -X POST ${completeUrl}\n`;
      prompt += "```";
    }

    setSendingToClaude(true);
    const toastId = toast.loading("Claude Code に送信中...");

    try {
      const response = await fetch(`${ADAS_API_URL}/api/claude-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId: `task-${task.id}` }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // SSE でレスポンスを受け取る
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE イベントをパース
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;

          const lines = eventStr.split("\n");
          let eventType = "";
          let data = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data = line.slice(5).trim();
            }
          }

          if (eventType === "done") {
            toast.success("Claude Code への送信が完了しました", { id: toastId });
            return;
          } else if (eventType === "error") {
            try {
              const parsed = JSON.parse(data);
              throw new Error(parsed.error);
            } catch {
              throw new Error("Unknown error");
            }
          }
        }
      }

      toast.success("Claude Code への送信が完了しました", { id: toastId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred";
      toast.error(`送信に失敗しました: ${errorMessage}`, { id: toastId });
    } finally {
      setSendingToClaude(false);
    }
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
                  <>
                    <Badge variant="default" className="text-xs bg-teal-500">
                      <BookOpen className="mr-1 h-3 w-3" />
                      用語
                    </Badge>
                    {task.vocabularySuggestionSourceType && (
                      <Badge variant="secondary" className="text-xs">
                        {VOCABULARY_SOURCE_LABELS[task.vocabularySuggestionSourceType] ??
                          task.vocabularySuggestionSourceType}
                      </Badge>
                    )}
                  </>
                )}
                {task.sourceType === "merge" && (
                  <Badge variant="default" className="text-xs bg-amber-500">
                    <GitMerge className="mr-1 h-3 w-3" />
                    統合
                  </Badge>
                )}
                {/* 詳細化ステータスインジケーター */}
                {task.elaborationStatus === "pending" && (
                  <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    詳細化中
                  </Badge>
                )}
                {task.elaborationStatus === "completed" && task.pendingElaboration && (
                  <Badge
                    variant="default"
                    className="text-xs bg-purple-500 cursor-pointer hover:bg-purple-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      onElaborate?.(task);
                    }}
                  >
                    <Wand2 className="mr-1 h-3 w-3" />
                    詳細化結果を確認
                  </Badge>
                )}
                {task.elaborationStatus === "applied" && (
                  <Badge variant="outline" className="text-xs text-purple-600 border-purple-400">
                    <Wand2 className="mr-1 h-3 w-3" />
                    詳細化済み
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
              {/* 類似タスク警告 */}
              {task.similarToTitle && (
                <div className="mt-1 flex items-start gap-1 rounded bg-yellow-50 p-1.5 text-xs text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <div>
                    <span className="font-medium">
                      類似: {task.similarToTitle} (
                      {task.similarToStatus === "completed" ? "完了" : "却下"})
                    </span>
                    {task.similarToReason && (
                      <span className="ml-1 text-yellow-600 dark:text-yellow-400">
                        - {task.similarToReason}
                      </span>
                    )}
                  </div>
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

            {/* 業務パターン変更 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 ${task.workType ? "text-purple-500 border-purple-200" : ""}`}
                >
                  {task.workType ? WORK_TYPE_LABELS[task.workType] : "パターン"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.entries(WORK_TYPE_LABELS) as [WorkType, string][]).map(([type, label]) => (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => onUpdateTask(task.id, { workType: type })}
                    className={task.workType === type ? "bg-accent" : ""}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
                {task.workType && (
                  <DropdownMenuItem
                    onClick={() => onUpdateTask(task.id, { workType: null })}
                    className="text-muted-foreground"
                  >
                    <X className="mr-2 h-4 w-4" />
                    パターン解除
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 承認・修正して承認・却下ボタン (承認待ちのみ) */}
            {task.status === "pending" && (
              <>
                <div className="h-4 w-px bg-border" />
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
                <>
                  <div className="h-4 w-px bg-border" />
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
                        onClick={() => onUpdateTask(task.id, { status: "pending" })}
                        className={task.status === "pending" ? "bg-accent" : ""}
                      >
                        <Circle className="mr-2 h-4 w-4 text-orange-500" />
                        承認待ちに戻す
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
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
                </>
              )}

            {/* 削除ボタン (右端) */}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7 text-destructive"
              onClick={() => onDeleteTask(task.id)}
              title="削除"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* 詳細 (展開時のみ) */}
          <CollapsibleContent className="mt-3 space-y-3">
            {/* AI関連アクション */}
            <div className="flex flex-wrap items-center gap-2">
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
              {/* GitHub Issue 作成ボタン */}
              {onCreateIssue &&
                !isApprovalOnlyTask(task.sourceType) &&
                task.projectId &&
                !task.githubIssueNumber && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onCreateIssue(task)}
                    title="GitHub Issue を作成"
                  >
                    <Github className="mr-1 h-3 w-3" />
                    Issue 作成
                  </Button>
                )}
              {/* 既に Issue が作成されている場合はリンクを表示 */}
              {task.githubIssueUrl && (
                <a
                  href={task.githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <Github className="h-3 w-3" />
                  Issue #{task.githubIssueNumber}
                </a>
              )}
              {!isApprovalOnlyTask(task.sourceType) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={simpleCopyToClipboard}
                  title="タスク情報をクリップボードにコピー"
                >
                  {simpleCopied ? (
                    <>
                      <Check className="mr-1 h-3 w-3" />
                      コピー済み
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="mr-1 h-3 w-3" />
                      コピー
                    </>
                  )}
                </Button>
              )}
              {!isApprovalOnlyTask(task.sourceType) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyToClipboard}
                  title="タスク情報 + API コマンドをコピー"
                >
                  {copied ? (
                    <>
                      <Check className="mr-1 h-3 w-3" />
                      コピー済み
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="mr-1 h-3 w-3" />
                      API付きコピー
                    </>
                  )}
                </Button>
              )}
              {!isApprovalOnlyTask(task.sourceType) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sendToClaude}
                  disabled={sendingToClaude}
                  title="Claude Code にタスク情報を送信"
                >
                  {sendingToClaude ? (
                    <>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      送信中...
                    </>
                  ) : (
                    <>
                      <Send className="mr-1 h-3 w-3" />
                      Claudeに送信
                    </>
                  )}
                </Button>
              )}
            </div>

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

            {/* 子タスク一覧 (親タスクの場合のみ) */}
            {allTasks &&
              task.parentId === null &&
              (() => {
                const childTasks = allTasks
                  .filter((t) => t.parentId === task.id)
                  .sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0));
                if (childTasks.length === 0) return null;
                return (
                  <div className="mt-3 rounded-md border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <ListTree className="h-4 w-4" />
                      子タスク ({childTasks.length}件)
                    </div>
                    <div className="space-y-1.5">
                      {childTasks.map((child) => (
                        <div
                          key={child.id}
                          className="flex items-center gap-2 rounded-md bg-background p-2 text-sm"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {child.stepNumber ?? "-"}
                          </span>
                          <span className="flex-1 truncate">{child.title}</span>
                          <Badge
                            variant={
                              child.status === "completed"
                                ? "default"
                                : child.status === "in_progress"
                                  ? "secondary"
                                  : "outline"
                            }
                            className={`text-xs ${
                              child.status === "completed"
                                ? "bg-green-500"
                                : child.status === "in_progress"
                                  ? "bg-blue-500 text-white"
                                  : ""
                            }`}
                          >
                            {child.status === "pending"
                              ? "未承認"
                              : child.status === "accepted"
                                ? "承認済"
                                : child.status === "in_progress"
                                  ? "進行中"
                                  : child.status === "completed"
                                    ? "完了"
                                    : child.status === "paused"
                                      ? "中断"
                                      : "却下"}
                          </Badge>
                          {/* ステータス変更ボタン */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreHorizontal className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {child.status === "pending" && (
                                <DropdownMenuItem
                                  onClick={() => onUpdateTask(child.id, { status: "accepted" })}
                                >
                                  <Check className="mr-2 h-4 w-4 text-green-500" />
                                  承認
                                </DropdownMenuItem>
                              )}
                              {(child.status === "accepted" || child.status === "paused") && (
                                <DropdownMenuItem
                                  onClick={() => onUpdateTask(child.id, { status: "in_progress" })}
                                >
                                  <Play className="mr-2 h-4 w-4 text-blue-500" />
                                  開始
                                </DropdownMenuItem>
                              )}
                              {child.status === "in_progress" && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => onUpdateTask(child.id, { status: "paused" })}
                                  >
                                    <Pause className="mr-2 h-4 w-4 text-yellow-500" />
                                    中断
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => onUpdateTask(child.id, { status: "completed" })}
                                  >
                                    <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                                    完了
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
