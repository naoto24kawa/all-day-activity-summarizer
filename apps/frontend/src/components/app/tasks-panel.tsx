/**
 * Tasks Panel Component
 *
 * Slack メッセージから抽出したタスクの表示・管理
 */

import type { Task, TaskStatus } from "@repo/types";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ListTodo,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
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
import { useTaskStats, useTasks } from "@/hooks/use-tasks";

interface TasksPanelProps {
  date: string;
  className?: string;
}

export function TasksPanel({ date, className }: TasksPanelProps) {
  const { tasks, loading, error, refetch, updateTask, deleteTask, extractTasks } = useTasks(date);
  const { stats } = useTaskStats(date);
  const [extracting, setExtracting] = useState(false);

  const handleExtract = async () => {
    setExtracting(true);
    try {
      await extractTasks({ date });
    } finally {
      setExtracting(false);
    }
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

  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const acceptedTasks = tasks.filter((t) => t.status === "accepted");
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const rejectedTasks = tasks.filter((t) => t.status === "rejected");

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          Tasks
          {stats.pending > 0 && (
            <Badge variant="destructive" className="ml-2">
              {stats.pending} pending
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExtract}
            disabled={extracting}
            title="Extract tasks from Slack"
          >
            <Sparkles className={`mr-1 h-3 w-3 ${extracting ? "animate-pulse" : ""}`} />
            {extracting ? "Extracting..." : "Extract"}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ListTodo className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No tasks for this date.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Extract" to analyze Slack messages.
            </p>
          </div>
        ) : (
          <Tabs defaultValue="pending" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="pending" className="flex items-center gap-1">
                <Circle className="h-3 w-3" />
                Pending
                {stats.pending > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {stats.pending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="accepted" className="flex items-center gap-1">
                <Check className="h-3 w-3" />
                Accepted
                {stats.accepted > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {stats.accepted}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Done
                {stats.completed > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {stats.completed}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="rejected" className="flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                Rejected
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="min-h-0 flex-1">
              <TaskList
                tasks={pendingTasks}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                showActions
              />
            </TabsContent>
            <TabsContent value="accepted" className="min-h-0 flex-1">
              <TaskList
                tasks={acceptedTasks}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                showCompleteAction
              />
            </TabsContent>
            <TabsContent value="completed" className="min-h-0 flex-1">
              <TaskList
                tasks={completedTasks}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
              />
            </TabsContent>
            <TabsContent value="rejected" className="min-h-0 flex-1">
              <TaskList tasks={rejectedTasks} onUpdateTask={updateTask} onDeleteTask={deleteTask} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function TaskList({
  tasks,
  onUpdateTask,
  onDeleteTask,
  showActions = false,
  showCompleteAction = false,
}: {
  tasks: Task[];
  onUpdateTask: (
    id: number,
    updates: { status?: TaskStatus; rejectReason?: string },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  showActions?: boolean;
  showCompleteAction?: boolean;
}) {
  if (tasks.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No tasks.</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            showActions={showActions}
            showCompleteAction={showCompleteAction}
          />
        ))}
      </div>
    </div>
  );
}

function TaskItem({
  task,
  onUpdateTask,
  onDeleteTask,
  showActions,
  showCompleteAction,
}: {
  task: Task;
  onUpdateTask: (
    id: number,
    updates: { status?: TaskStatus; rejectReason?: string },
  ) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  showActions?: boolean;
  showCompleteAction?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

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
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3 space-y-3">
            {task.description && (
              <p className="text-sm text-muted-foreground">{task.description}</p>
            )}
            {task.rejectReason && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">Reject reason:</span> {task.rejectReason}
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
                    Accept
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRejectDialogOpen(true)}>
                    <X className="mr-1 h-3 w-3" />
                    Reject
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
                  Complete
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => onDeleteTask(task.id)}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Delete
              </Button>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Task</DialogTitle>
            <DialogDescription>
              Why are you rejecting this task? This helps improve future task extraction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm font-medium">{task.title}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reject-reason">Reason (optional)</Label>
              <Textarea
                id="reject-reason"
                placeholder="e.g., Not actionable, Already done, Wrong interpretation..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
