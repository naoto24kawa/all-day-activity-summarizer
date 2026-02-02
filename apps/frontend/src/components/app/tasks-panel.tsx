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
  WORK_TYPES,
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
  Info,
  ListTree,
  Loader2,
  MessageSquare,
  Mic,
  Minus,
  Moon,
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
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useJobProgress } from "@/hooks/use-job-progress";
import { useNotifications } from "@/hooks/use-notifications";
import { getProjectName, useProjects } from "@/hooks/use-projects";
import {
  useGenerateImprovement,
  usePromptImprovement,
  usePromptImprovementStats,
} from "@/hooks/use-prompt-improvements";
import { useTaskStats, useTasks } from "@/hooks/use-tasks";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";
import { getTodayDateString } from "@/lib/date";
import { BulkElaborateDialog } from "./bulk-elaborate-dialog";
import { DuplicateSuggestionsPanel } from "./duplicate-suggestions-panel";
import { TaskElaborateDialog } from "./task-elaborate-dialog";

interface TasksPanelProps {
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
  someday: "opacity-50 border-purple-300 dark:border-purple-700",
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
  {
    status: "someday",
    label: "いつか",
    icon: Moon,
    activeClass:
      "bg-purple-100 border-purple-400 text-purple-700 dark:bg-purple-950 dark:border-purple-600 dark:text-purple-300",
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

const STORAGE_KEY_STATUS_FILTER = "adas-tasks-status-filter";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex UI component with many states
export function TasksPanel({ className }: TasksPanelProps) {
  const date = getTodayDateString();
  // ステータスフィルター (useTasks より先に定義)
  // localStorage から復元、なければ "pending"
  const [statusFilter, setStatusFilter] = useState<TaskStatus>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_STATUS_FILTER);
    if (
      saved &&
      ["pending", "accepted", "in_progress", "paused", "completed", "rejected", "someday"].includes(
        saved,
      )
    ) {
      return saved as TaskStatus;
    }
    return "pending";
  });

  // statusFilter の変更を localStorage に保存
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_STATUS_FILTER, statusFilter);
  }, [statusFilter]);

  const {
    tasks,
    loading,
    error,
    refetch,
    updateTask,
    updateTaskOptimistic,
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
  } = useTasks(statusFilter);
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
  const [workTypeFilter, setWorkTypeFilter] = useState<WorkType | "all">("all");
  const [elaborationFilter, setElaborationFilter] = useState<
    "all" | "elaborated" | "not-elaborated"
  >("all");
  const [checkingCompletion, setCheckingCompletion] = useState(false);
  const [completionCheckJobId, setCompletionCheckJobId] = useState<number | null>(null);

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

  // タスク詳細化
  const [elaborateDialogOpen, setElaborateDialogOpen] = useState(false);
  const [elaborateTargetTask, setElaborateTargetTask] = useState<Task | null>(null);

  // 詳細化ジョブ追跡 (ジョブID -> タスクID のマッピング)
  const [elaborationJobMap, setElaborationJobMap] = useState<Map<number, number>>(new Map());
  // 詳細化中のタスクID
  const elaboratingTaskIds = new Set(elaborationJobMap.values());

  // Claude送信ジョブ追跡 (ジョブID -> タスクID のマッピング)
  const [claudeChatJobMap, setClaudeChatJobMap] = useState<Map<number, number>>(new Map());
  // Claude送信中のタスクID
  const sendingToClaudeTaskIds = new Set(claudeChatJobMap.values());

  const openElaborateDialog = (task: Task) => {
    setElaborateTargetTask(task);
    setElaborateDialogOpen(true);
  };

  const closeElaborateDialog = () => {
    setElaborateDialogOpen(false);
    setElaborateTargetTask(null);
  };

  // 詳細化ダイアログを開く
  const handleElaborate = (task: Task) => {
    // 既に詳細化中の場合はスキップ
    if (task.elaborationStatus === "pending" || elaboratingTaskIds.has(task.id)) {
      toast.info("詳細化中です", { description: "しばらくお待ちください" });
      return;
    }

    // ダイアログを開く (入力フェーズまたはプレビューフェーズ)
    openElaborateDialog(task);
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

    // Exclude child tasks (show only parent tasks in main list)
    // Child tasks are displayed within parent task's detail section
    result = result.filter((t) => !t.parentId);

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

    // WorkType filter
    if (workTypeFilter !== "all") {
      result = result.filter((t) => t.workType === workTypeFilter);
    }

    // Elaboration filter
    if (elaborationFilter !== "all") {
      if (elaborationFilter === "elaborated") {
        result = result.filter((t) => t.elaborationStatus === "applied");
      } else {
        result = result.filter((t) => t.elaborationStatus !== "applied");
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

  // 完了チェックジョブの追跡
  const fetchCompletionResult = async (jobId: number) => {
    try {
      const result = await fetchAdasApi<{
        jobId: number;
        status: string;
        result?: SuggestCompletionsResponse;
      }>(`/api/tasks/suggest-completions/result/${jobId}`);

      if (result.result) {
        setCompletionSuggestions(result.result.suggestions);
        if (result.result.suggestions.length > 0) {
          toast.success(`${result.result.suggestions.length}件の完了候補を検出しました`);
        } else {
          toast.info("完了候補はありませんでした");
        }
      }
    } catch (err) {
      console.error("Failed to fetch completion result:", err);
      toast.error("完了チェック結果の取得に失敗しました");
    }
  };

  const { trackJob: trackCompletionJob, isProcessing: isCompletionJobProcessing } = useJobProgress({
    onJobCompleted: (jobId) => {
      if (jobId === completionCheckJobId) {
        fetchCompletionResult(jobId);
        setCompletionCheckJobId(null);
        setCheckingCompletion(false);
      }
    },
  });

  // 詳細化ジョブ追跡
  const { trackJob: trackElaborationJob } = useJobProgress({
    onJobCompleted: (jobId) => {
      // ジョブIDからタスクIDを取得
      setElaborationJobMap((prev) => {
        const taskId = prev.get(jobId);
        if (taskId) {
          toast.success("詳細化が完了しました", {
            description: `タスク #${taskId} の詳細化が完了しました`,
          });
        }
        const next = new Map(prev);
        next.delete(jobId);
        return next;
      });
      // タスクリストをリフレッシュ
      refetch();
    },
  });

  // 詳細化ジョブを登録
  const trackElaboration = useCallback(
    (jobId: number, taskId: number) => {
      setElaborationJobMap((prev) => {
        const next = new Map(prev);
        next.set(jobId, taskId);
        return next;
      });
      trackElaborationJob(jobId);
    },
    [trackElaborationJob],
  );

  // Claude送信ジョブ追跡
  const { trackJob: trackClaudeChatJob } = useJobProgress({
    onJobCompleted: (jobId) => {
      // ジョブIDからタスクIDを取得
      setClaudeChatJobMap((prev) => {
        const taskId = prev.get(jobId);
        if (taskId) {
          toast.success("Claude への送信が完了しました", {
            description: `タスク #${taskId} の情報を送信しました`,
          });
        }
        const next = new Map(prev);
        next.delete(jobId);
        return next;
      });
    },
  });

  // Claude送信ジョブを登録
  const trackClaudeChat = useCallback(
    (jobId: number, taskId: number) => {
      setClaudeChatJobMap((prev) => {
        const next = new Map(prev);
        next.set(jobId, taskId);
        return next;
      });
      trackClaudeChatJob(jobId);
    },
    [trackClaudeChatJob],
  );

  const handleCheckCompletions = async () => {
    setCheckingCompletion(true);
    setCompletionSuggestions([]);
    try {
      // 非同期ジョブとして登録
      const response = await postAdasApi<{ jobId: number; status: string }>(
        "/api/tasks/suggest-completions/async",
        { date },
      );
      setCompletionCheckJobId(response.jobId);
      trackCompletionJob(response.jobId);
    } catch (err) {
      console.error("Failed to start completion check:", err);
      toast.error("完了チェックの開始に失敗しました");
      setCheckingCompletion(false);
    }
  };

  const handleCompleteFromSuggestion = async (taskId: number) => {
    await updateTask(taskId, { status: "completed" });
    setCompletionSuggestions((prev) => prev.filter((s) => s.taskId !== taskId));
  };

  // ステータスラベルのマップ
  const statusLabels: Record<TaskStatus, string> = {
    pending: "承認待ち",
    accepted: "承認済み",
    in_progress: "進行中",
    paused: "中断",
    completed: "完了",
    rejected: "却下",
    someday: "いつか",
  };

  // 楽観的更新でタスクを更新 (UIを即座に反映し、完了時にトースト通知)
  const handleUpdateTaskOptimistic = useCallback(
    async (taskId: number, updates: Parameters<typeof updateTaskOptimistic>[1]): Promise<void> => {
      const task = tasks.find((t) => t.id === taskId);
      const { promise, rollback } = updateTaskOptimistic(taskId, updates);

      promise
        .then(() => {
          const statusLabel = updates.status ? statusLabels[updates.status] : null;
          const message = statusLabel
            ? `「${task?.title ?? "タスク"}」を${statusLabel}に変更しました`
            : `「${task?.title ?? "タスク"}」を更新しました`;
          toast.success(message);
        })
        .catch((err) => {
          rollback();
          toast.error(`更新に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`);
        });
      // 即座に resolve (楽観的更新なので待たない)
    },
    [tasks, updateTaskOptimistic],
  );

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

        // 重複が見つかった場合は「承認済み」フィルターに切り替え
        if (duplicateCount > 0) {
          setStatusFilter("accepted");
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

  // API から既にステータスでフィルタされたタスクが返ってくる
  // 追加のフィルタ (子タスク除外、ソース、プロジェクト) とソートを適用
  const filteredTasksByStatus = (() => {
    const filtered = filterTasks(tasks);
    // accepted は優先度でソート、その他は日付でソート
    if (statusFilter === "accepted") {
      return sortByPriority(filtered);
    }
    return sortByDateDesc(filtered);
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>AIがSlack/GitHubから抽出したタスク候補です。</p>
                <p>承認するとタスク化されます。</p>
              </TooltipContent>
            </Tooltip>
            {stats.pending > 0 && (
              <Badge variant="destructive" className="ml-2">
                {stats.pending} 件の承認待ち
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
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
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {/* ステータスフィルター */}
        {stats.total > 0 && (
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
                  {/* 未完了ステータスのみバッジ表示 */}
                  {count > 0 &&
                    ["pending", "accepted", "in_progress", "paused"].includes(status) && (
                      <span className={`ml-0.5 ${isActive ? "" : "opacity-60"}`}>{count}</span>
                    )}
                </button>
              );
            })}
          </div>
        )}

        {/* Filters */}
        {tasks.length > 0 && (
          <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-2">
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
              {/* WorkType Filter */}
              <Select
                value={workTypeFilter}
                onValueChange={(value) => setWorkTypeFilter(value as WorkType | "all")}
              >
                <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs">
                  <SelectValue placeholder="パターン" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全パターン</SelectItem>
                  {WORK_TYPES.map((wt) => (
                    <SelectItem key={wt} value={wt}>
                      {WORK_TYPE_LABELS[wt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Elaboration Filter */}
              <Select
                value={elaborationFilter}
                onValueChange={(value) =>
                  setElaborationFilter(value as "all" | "elaborated" | "not-elaborated")
                }
              >
                <SelectTrigger className="h-7 w-auto min-w-[90px] text-xs">
                  <SelectValue placeholder="詳細化" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全て</SelectItem>
                  <SelectItem value="elaborated">詳細化済み</SelectItem>
                  <SelectItem value="not-elaborated">未詳細化</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* 一括操作モードトグル */}
            <Button
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
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
                  一括操作
                </>
              )}
            </Button>
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

        {stats.total === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">AIが抽出したタスク候補はありません</p>
            <p className="mt-1 text-xs text-muted-foreground">
              「Extract」をクリックしてSlack/GitHubからタスクを抽出できます
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
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
                        <DropdownMenuItem onClick={() => handleBatchUpdate({ status: "someday" })}>
                          <Moon className="mr-2 h-4 w-4 text-purple-500" />
                          いつか
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
                      disabled={checkingCompletion || isCompletionJobProcessing}
                      title="完了チェック"
                    >
                      <Search
                        className={`mr-1 h-3 w-3 ${checkingCompletion || isCompletionJobProcessing ? "animate-pulse" : ""}`}
                      />
                      {checkingCompletion || isCompletionJobProcessing
                        ? "チェック中..."
                        : "完了チェック"}
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
              onUpdateTask={handleUpdateTaskOptimistic}
              onDeleteTask={deleteTask}
              onElaborate={handleElaborate}
              onCreateIssue={handleCreateIssue}
              suggestionTaskIds={suggestionTaskIds}
              elaboratingTaskIds={elaboratingTaskIds}
              sendingToClaudeTaskIds={sendingToClaudeTaskIds}
              onSendToClaude={trackClaudeChat}
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
          onStartElaborate={async (taskId, request) => {
            const result = await startElaborate(taskId, request);
            // ジョブを追跡 (ダイアログ閉じても完了通知を受け取れるように)
            trackElaboration(result.jobId, taskId);
            return result;
          }}
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
        onStartBulkElaborate={async (request) => {
          const result = await startBulkElaborate(request);
          // 各ジョブを追跡
          for (let i = 0; i < result.jobIds.length; i++) {
            const jobId = result.jobIds[i];
            const taskId = result.taskIds[i];
            if (jobId !== undefined && taskId !== undefined) {
              trackElaboration(jobId, taskId);
            }
          }
          return result;
        }}
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
  elaboratingTaskIds,
  sendingToClaudeTaskIds,
  onSendToClaude,
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
  elaboratingTaskIds?: Set<number>;
  sendingToClaudeTaskIds?: Set<number>;
  onSendToClaude?: (jobId: number, taskId: number) => void;
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
            isElaborating={elaboratingTaskIds?.has(task.id)}
            isSendingToClaude={sendingToClaudeTaskIds?.has(task.id)}
            onSendToClaude={onSendToClaude}
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
  isElaborating,
  isSendingToClaude,
  onSendToClaude,
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
  isElaborating?: boolean;
  isSendingToClaude?: boolean;
  onSendToClaude?: (jobId: number, taskId: number) => void;
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

  // ステータスに応じた更新アクションを生成 (パスのみ)
  const getStatusActions = (
    taskId: number,
    status: string,
  ): { action: string; path: string; body?: string }[] => {
    const actions: { action: string; path: string; body?: string }[] = [];
    if (status === "accepted") {
      actions.push({ action: "開始", path: `/api/tasks/${taskId}/start` });
      actions.push({ action: "完了", path: `/api/tasks/${taskId}/complete` });
      actions.push({
        action: "中断",
        path: `/api/tasks/${taskId}/pause`,
        body: '{"reason": "理由"}',
      });
    } else if (status === "in_progress") {
      actions.push({ action: "完了", path: `/api/tasks/${taskId}/complete` });
      actions.push({
        action: "中断",
        path: `/api/tasks/${taskId}/pause`,
        body: '{"reason": "理由"}',
      });
    } else if (status === "paused") {
      actions.push({ action: "再開", path: `/api/tasks/${taskId}/start` });
      actions.push({ action: "完了", path: `/api/tasks/${taskId}/complete` });
    }
    return actions;
  };

  // クリップボードにコピー (タスク情報 + API コマンド)
  const copyToClipboard = async () => {
    const baseUrl = ADAS_API_URL;
    let text = `## ${task.title}`;
    if (task.description) {
      text += `\n\n${task.description}`;
    }

    // 親タスク情報を追加 (子タスクの場合)
    if (allTasks && task.parentId !== null) {
      const parentTask = allTasks.find((t) => t.id === task.parentId);
      if (parentTask) {
        text += `\n\n### 親タスク\n- #${parentTask.id} ${parentTask.title}`;
      }
    }

    // 子タスクを取得
    const childTasks =
      allTasks && task.parentId === null
        ? allTasks
            .filter((t) => t.parentId === task.id)
            .sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0))
        : [];

    // --- API セクション ---
    text += "\n\n---\n";
    text += `### API (Base: ${baseUrl})\n\n`;

    // タスクURL一覧
    text += "**タスクURL**\n";
    text += `- #${task.id} (このタスク): /api/tasks/${task.id}\n`;
    for (const child of childTasks) {
      text += `- #${child.id} ${child.title}: /api/tasks/${child.id}\n`;
    }

    // 更新コマンド
    text += "\n**更新コマンド** (curl -X POST {Base}{path})\n";

    // 親タスク
    const parentActions = getStatusActions(task.id, task.status);
    if (parentActions.length > 0) {
      text += `\n*#${task.id} (${task.status})*\n`;
      for (const a of parentActions) {
        if (a.body) {
          text += `- ${a.action}: POST ${a.path} + ${a.body}\n`;
        } else {
          text += `- ${a.action}: POST ${a.path}\n`;
        }
      }
    }

    // 子タスク
    for (const child of childTasks) {
      const childActions = getStatusActions(child.id, child.status);
      if (childActions.length > 0) {
        text += `\n*#${child.id} ${child.title} (${child.status})*\n`;
        for (const a of childActions) {
          if (a.body) {
            text += `- ${a.action}: POST ${a.path} + ${a.body}\n`;
          } else {
            text += `- ${a.action}: POST ${a.path}\n`;
          }
        }
      }
    }

    // PATCH (タイトル・説明の更新)
    text += `\n**フィールド更新** (curl -X PATCH {Base}/api/tasks/{id} -H "Content-Type: application/json" -d '{...}')\n`;
    text += "更新可能: title, description, priority, workType, dueDate, projectId\n";

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Claude Code にタスク情報を送信 (非同期ジョブとして実行)
  const sendToClaude = async () => {
    if (isSendingToClaude) return;

    const baseUrl = ADAS_API_URL;
    let prompt = `## ${task.title}`;
    if (task.description) {
      prompt += `\n\n${task.description}`;
    }

    // 親タスク情報を追加 (子タスクの場合)
    if (allTasks && task.parentId !== null) {
      const parentTask = allTasks.find((t) => t.id === task.parentId);
      if (parentTask) {
        prompt += `\n\n### 親タスク\n- #${parentTask.id} ${parentTask.title}`;
      }
    }

    // 子タスクを取得
    const childTasks =
      allTasks && task.parentId === null
        ? allTasks
            .filter((t) => t.parentId === task.id)
            .sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0))
        : [];

    // --- API セクション ---
    prompt += "\n\n---\n";
    prompt += `### API (Base: ${baseUrl})\n\n`;

    // タスクURL一覧
    prompt += "**タスクURL**\n";
    prompt += `- #${task.id} (このタスク): /api/tasks/${task.id}\n`;
    for (const child of childTasks) {
      prompt += `- #${child.id} ${child.title}: /api/tasks/${child.id}\n`;
    }

    // 更新コマンド
    prompt += "\n**更新コマンド** (curl -X POST {Base}{path})\n";

    // 親タスク
    const parentActions = getStatusActions(task.id, task.status);
    if (parentActions.length > 0) {
      prompt += `\n*#${task.id} (${task.status})*\n`;
      for (const a of parentActions) {
        if (a.body) {
          prompt += `- ${a.action}: POST ${a.path} + ${a.body}\n`;
        } else {
          prompt += `- ${a.action}: POST ${a.path}\n`;
        }
      }
    }

    // 子タスク
    for (const child of childTasks) {
      const childActions = getStatusActions(child.id, child.status);
      if (childActions.length > 0) {
        prompt += `\n*#${child.id} ${child.title} (${child.status})*\n`;
        for (const a of childActions) {
          if (a.body) {
            prompt += `- ${a.action}: POST ${a.path} + ${a.body}\n`;
          } else {
            prompt += `- ${a.action}: POST ${a.path}\n`;
          }
        }
      }
    }

    // PATCH (タイトル・説明の更新)
    prompt += `\n**フィールド更新** (curl -X PATCH {Base}/api/tasks/{id} -H "Content-Type: application/json" -d '{...}')\n`;
    prompt += "更新可能: title, description, priority, workType, dueDate, projectId\n";

    try {
      // 非同期ジョブとして登録
      const response = await postAdasApi<{ jobId: number; status: string }>(
        "/api/claude-chat/async",
        { prompt, taskId: task.id },
      );

      // ジョブを追跡
      onSendToClaude?.(response.jobId, task.id);
      toast.info("Claude Code への送信を開始しました");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred";
      toast.error(`送信に失敗しました: ${errorMessage}`);
    }
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className={`rounded-md border p-3 ${getTaskStyle(task, isSelected, isSuggested)}`}>
          {/* ヘッダー: タイトル + ソースバッジ */}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-start justify-between text-left cursor-pointer"
            >
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
                  {(task.elaborationStatus === "pending" || isElaborating) && (
                    <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      詳細化中
                    </Badge>
                  )}
                  {/* Claude送信中インジケーター */}
                  {isSendingToClaude && (
                    <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Claude送信中
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
            </button>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onUpdateTask(task.id, { status: "someday" })}
                >
                  <Moon className="mr-1 h-3 w-3" />
                  いつか
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
                        {task.status === "someday" && <Moon className="h-3 w-3" />}
                        {task.status === "accepted" && "未着手"}
                        {task.status === "in_progress" && "進行中"}
                        {task.status === "paused" && "中断"}
                        {task.status === "completed" && "完了"}
                        {task.status === "someday" && "いつか"}
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => onUpdateTask(task.id, { status: "pending" })}
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
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onUpdateTask(task.id, { status: "someday" })}
                        className={task.status === "someday" ? "bg-accent" : ""}
                      >
                        <Moon className="mr-2 h-4 w-4 text-purple-500" />
                        いつか
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
                  disabled={isSendingToClaude}
                  title="Claude Code にタスク情報を送信"
                >
                  {isSendingToClaude ? (
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
                    <div className="space-y-2">
                      {childTasks.map((child) => (
                        <div key={child.id} className="flex items-start gap-2">
                          <span className="mt-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                            {child.stepNumber ?? "-"}
                          </span>
                          <div className="flex-1">
                            <TaskItem
                              task={child}
                              projects={projects}
                              onUpdateTask={onUpdateTask}
                              onDeleteTask={onDeleteTask}
                              onElaborate={onElaborate}
                              onCreateIssue={onCreateIssue}
                            />
                          </div>
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
