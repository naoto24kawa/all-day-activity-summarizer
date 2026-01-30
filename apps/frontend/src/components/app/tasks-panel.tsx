/**
 * Tasks Panel Component
 *
 * Slack メッセージから抽出したタスクの表示・管理
 */

import type {
  Project,
  SuggestCompletionsResponse,
  Task,
  TaskCompletionSuggestion,
  TaskSourceType,
  TaskStatus,
} from "@repo/types";
import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCopy,
  FileText,
  Filter,
  FolderGit2,
  Github,
  MessageSquare,
  MessageSquareMore,
  Mic,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import Markdown from "react-markdown";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNotifications } from "@/hooks/use-notifications";
import { getProjectName, useProjects } from "@/hooks/use-projects";
import { useTaskStats, useTasks } from "@/hooks/use-tasks";
import { ADAS_API_URL } from "@/lib/adas-api";

interface TasksPanelProps {
  date: string;
  className?: string;
}

export function TasksPanel({ date, className }: TasksPanelProps) {
  const {
    tasks,
    loading,
    error,
    refetch,
    updateTask,
    deleteTask,
    extractTasks,
    extractGitHubTasks,
    extractGitHubCommentTasks,
    extractMemoTasks,
  } = useTasks(date);
  const { stats } = useTaskStats(date);
  const { projects } = useProjects();
  const { permission, requestPermission, notifyHighPriorityTask } = useNotifications();
  const [extracting, setExtracting] = useState(false);

  const [sourceFilter, setSourceFilter] = useState<TaskSourceType | "all">("all");
  const [projectFilter, setProjectFilter] = useState<number | "all" | "none">("all");
  const [checkingCompletion, setCheckingCompletion] = useState(false);
  const [completionSuggestions, setCompletionSuggestions] = useState<TaskCompletionSuggestion[]>(
    [],
  );
  const [completionStats, setCompletionStats] = useState<
    SuggestCompletionsResponse["evaluated"] | null
  >(null);

  const getSourceLabel = (sourceType: string) => {
    switch (sourceType) {
      case "github":
        return "GitHub";
      case "github-comment":
        return "GitHub Comment";
      case "memo":
        return "Memo";
      case "prompt-improvement":
        return "改善";
      default:
        return "Slack";
    }
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

  const notifyHighPriorityTasks = (extractedTasks: Task[]) => {
    const highPriorityTasks = extractedTasks.filter((t) => t.priority === "high");
    for (const task of highPriorityTasks) {
      notifyHighPriorityTask(task.title, getSourceLabel(task.sourceType));
    }
  };

  const handleExtractSlack = async () => {
    setExtracting(true);
    try {
      const result = await extractTasks({ date });
      if (result.tasks.length > 0) {
        notifyHighPriorityTasks(result.tasks);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractGitHub = async () => {
    setExtracting(true);
    try {
      const result = await extractGitHubTasks({ date });
      if (result.tasks.length > 0) {
        notifyHighPriorityTasks(result.tasks);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractGitHubComments = async () => {
    setExtracting(true);
    try {
      const result = await extractGitHubCommentTasks({ date });
      if (result.tasks.length > 0) {
        notifyHighPriorityTasks(result.tasks);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractMemos = async () => {
    setExtracting(true);
    try {
      const result = await extractMemoTasks({ date });
      if (result.tasks.length > 0) {
        notifyHighPriorityTasks(result.tasks);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractAll = async () => {
    setExtracting(true);
    try {
      const [slackResult, githubResult, githubCommentResult, memoResult] = await Promise.all([
        extractTasks({ date }),
        extractGitHubTasks({ date }),
        extractGitHubCommentTasks({ date }),
        extractMemoTasks({ date }),
      ]);
      const allTasks = [
        ...slackResult.tasks,
        ...githubResult.tasks,
        ...githubCommentResult.tasks,
        ...memoResult.tasks,
      ];
      if (allTasks.length > 0) {
        notifyHighPriorityTasks(allTasks);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleCheckCompletions = async () => {
    setCheckingCompletion(true);
    setCompletionSuggestions([]);
    setCompletionStats(null);
    try {
      const response = await fetch(`${ADAS_API_URL}/api/tasks/suggest-completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!response.ok) {
        throw new Error("Failed to check completions");
      }
      const data = (await response.json()) as SuggestCompletionsResponse;
      setCompletionSuggestions(data.suggestions);
      setCompletionStats(data.evaluated);
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

  const pendingTasks = filterTasks(tasks.filter((t) => t.status === "pending"));
  const acceptedTasks = filterTasks(tasks.filter((t) => t.status === "accepted"));
  const completedTasks = filterTasks(tasks.filter((t) => t.status === "completed"));
  const rejectedTasks = filterTasks(tasks.filter((t) => t.status === "rejected"));

  // Count tasks by source for filter badges
  const sourceCount = {
    all: tasks.length,
    slack: tasks.filter((t) => t.sourceType === "slack").length,
    github: tasks.filter((t) => t.sourceType === "github" || t.sourceType === "github-comment")
      .length,
    "prompt-improvement": tasks.filter((t) => t.sourceType === "prompt-improvement").length,
    memo: tasks.filter((t) => t.sourceType === "memo").length,
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
                showActions
              />
            </TabsContent>
            <TabsContent value="accepted" className="min-h-0 flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCheckCompletions}
                  disabled={checkingCompletion || acceptedTasks.length === 0}
                  className="gap-1"
                >
                  <Search className="h-3 w-3" />
                  {checkingCompletion ? "チェック中..." : "完了チェック"}
                </Button>
                {completionStats && (
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span>評価: {completionStats.total}件</span>
                    {completionStats.github > 0 && <span>GitHub: {completionStats.github}</span>}
                    {completionStats.claudeCode > 0 && (
                      <span>Claude: {completionStats.claudeCode}</span>
                    )}
                    {completionStats.slack > 0 && <span>Slack: {completionStats.slack}</span>}
                    {completionStats.transcribe > 0 && (
                      <span>Transcribe: {completionStats.transcribe}</span>
                    )}
                  </div>
                )}
              </div>

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
                showCompleteAction
                suggestionTaskIds={suggestionTaskIds}
              />
            </TabsContent>
            <TabsContent value="completed" className="min-h-0 flex-1">
              <TaskList
                tasks={completedTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
              />
            </TabsContent>
            <TabsContent value="rejected" className="min-h-0 flex-1">
              <TaskList
                tasks={rejectedTasks}
                projects={projects}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
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
  showActions = false,
  showCompleteAction = false,
  suggestionTaskIds,
}: {
  tasks: Task[];
  projects: Project[];
  onUpdateTask: (
    id: number,
    updates: { status?: TaskStatus; rejectReason?: string; title?: string; description?: string },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  showActions?: boolean;
  showCompleteAction?: boolean;
  suggestionTaskIds?: Set<number>;
}) {
  if (tasks.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">タスクはありません</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            projects={projects}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            showActions={showActions}
            showCompleteAction={showCompleteAction}
            isSuggested={suggestionTaskIds?.has(task.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TaskItem({
  task,
  projects,
  onUpdateTask,
  onDeleteTask,
  showActions,
  showCompleteAction,
  isSuggested,
}: {
  task: Task;
  projects: Project[];
  onUpdateTask: (
    id: number,
    updates: { status?: TaskStatus; rejectReason?: string; title?: string; description?: string },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  showActions?: boolean;
  showCompleteAction?: boolean;
  isSuggested?: boolean;
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

  const projectName = getProjectName(projects, task.projectId);

  const priorityColors: Record<string, string> = {
    high: "text-red-500",
    medium: "text-yellow-500",
    low: "text-green-500",
  };

  const confidenceLabel = (confidence: number | null) => {
    if (confidence === null) return null;
    if (confidence >= 0.9) return "High";
    if (confidence >= 0.7) return "Medium";
    return "Low";
  };

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
    text += "\n\n---\n";
    text += `タスク完了時は以下を実行してください:\n`;
    text += `\`\`\`bash\n`;
    text += `curl -X POST ${ADAS_API_URL}/api/tasks/${task.id}/complete\n`;
    text += `\`\`\``;

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          className={`rounded-md border p-3 ${
            task.status === "completed"
              ? "opacity-60"
              : task.status === "rejected"
                ? "opacity-50"
                : task.status === "pending"
                  ? "border-primary/30 bg-primary/5"
                  : isSuggested
                    ? "border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-950"
                    : ""
          }`}
        >
          <CollapsibleTrigger className="flex w-full items-start justify-between text-left">
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-2">
                {task.priority && (
                  <span className={`text-xs font-medium ${priorityColors[task.priority] ?? ""}`}>
                    {task.priority.toUpperCase()}
                  </span>
                )}
                <span className="font-medium">{task.title}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {task.confidence !== null && (
                  <Badge variant="outline" className="text-xs">
                    Confidence: {confidenceLabel(task.confidence)}
                  </Badge>
                )}
                {task.dueDate && (
                  <Badge variant="outline" className="text-xs">
                    Due: {task.dueDate}
                  </Badge>
                )}
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
                {projectName && (
                  <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200">
                    <FolderGit2 className="mr-1 h-3 w-3" />
                    {projectName}
                  </Badge>
                )}
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>

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
                    <Markdown>{task.description}</Markdown>
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

            <div className="flex items-center gap-2">
              {showActions && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onUpdateTask(task.id, { status: "accepted" })}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    承認
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditDialog("edit-approve")}
                  >
                    <Wand2 className="mr-1 h-3 w-3" />
                    修正して承認
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRejectDialogOpen(true)}>
                    <X className="mr-1 h-3 w-3" />
                    却下
                  </Button>
                </>
              )}
              {showCompleteAction && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onUpdateTask(task.id, { status: "completed" })}
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  完了
                </Button>
              )}
              {!showActions && (
                <Button variant="outline" size="sm" onClick={() => openEditDialog("edit")}>
                  <Pencil className="mr-1 h-3 w-3" />
                  編集
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
    </>
  );
}
