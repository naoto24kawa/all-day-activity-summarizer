/**
 * Project Activity Panel
 *
 * 選択したプロジェクトの更新事項を表示するパネル
 */

import type { Project } from "@repo/types";
import {
  BookOpen,
  CheckSquare,
  ExternalLink,
  FolderKanban,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { type ProjectActivity, useProjectActivities } from "@/hooks/use-project-activities";

interface ProjectActivityPanelProps {
  project: Project | null;
  className?: string;
}

type ActivityFilter = "all" | "slack" | "claude" | "notion" | "task" | "learning";

const FILTER_TABS = [
  { id: "all" as const, label: "All" },
  { id: "slack" as const, label: "Slack", icon: MessageSquare },
  { id: "claude" as const, label: "Claude", icon: Terminal },
  { id: "notion" as const, label: "Notion", icon: NotebookPen },
  { id: "task" as const, label: "Tasks", icon: CheckSquare },
  { id: "learning" as const, label: "Learnings", icon: BookOpen },
];

export function ProjectActivityPanel({ project, className }: ProjectActivityPanelProps) {
  const { activities, loading, error, refetch, counts } = useProjectActivities({
    projectId: project?.id ?? null,
  });
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const filteredActivities =
    filter === "all" ? activities : activities.filter((a) => a.type === filter);

  if (!project) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-muted-foreground" />
            Project Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            左のリストからプロジェクトを選択してください
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-indigo-500" />
            {project.name}
          </CardTitle>
          <Button size="icon" variant="ghost" onClick={() => refetch()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {project.path && (
          <p className="text-xs text-muted-foreground truncate" title={project.path}>
            {project.path}
          </p>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
        {/* フィルタータブ */}
        <SegmentedTabs
          tabs={FILTER_TABS.map((tab) => ({
            ...tab,
            badge: tab.id === "all" ? activities.length : counts[tab.id],
          }))}
          value={filter}
          onValueChange={(v) => setFilter(v as ActivityFilter)}
          className="mb-3"
        />

        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filteredActivities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "このプロジェクトにはまだアクティビティがありません"
              : `${filter} のアクティビティはありません`}
          </p>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-4">
              {filteredActivities.map((activity) => (
                <ActivityItem key={`${activity.type}-${activity.id}`} activity={activity} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

interface ActivityItemProps {
  activity: ProjectActivity;
}

function ActivityItem({ activity }: ActivityItemProps) {
  const Icon = getActivityIcon(activity.type);
  const color = getActivityColor(activity.type);

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{activity.title}</span>
            <Badge variant="outline" className="shrink-0 text-xs">
              {getActivityLabel(activity.type)}
            </Badge>
          </div>
          {activity.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{activity.description}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{activity.date}</span>
            {activity.url && (
              <a
                href={activity.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Open
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getActivityIcon(type: ProjectActivity["type"]) {
  switch (type) {
    case "slack":
      return MessageSquare;
    case "claude":
      return Terminal;
    case "notion":
      return NotebookPen;
    case "task":
      return CheckSquare;
    case "learning":
      return BookOpen;
    default:
      return FolderKanban;
  }
}

function getActivityColor(type: ProjectActivity["type"]): string {
  switch (type) {
    case "slack":
      return "text-purple-500";
    case "claude":
      return "text-orange-500";
    case "notion":
      return "text-gray-500";
    case "task":
      return "text-blue-500";
    case "learning":
      return "text-green-500";
    default:
      return "text-muted-foreground";
  }
}

function getActivityLabel(type: ProjectActivity["type"]): string {
  switch (type) {
    case "slack":
      return "Slack";
    case "claude":
      return "Claude";
    case "notion":
      return "Notion";
    case "task":
      return "Task";
    case "learning":
      return "Learning";
    default:
      return type;
  }
}
