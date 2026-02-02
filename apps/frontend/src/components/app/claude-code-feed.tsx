/**
 * Claude Code Feed Component
 *
 * Displays Claude Code sessions grouped by project
 */

import type { ClaudeCodeMessage, ClaudeCodeSession } from "@repo/types";
import {
  ChevronDown,
  Code,
  FolderGit2,
  MessageSquare,
  RefreshCw,
  Settings,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useClaudeCodePaths } from "@/hooks/use-claude-code-paths";
import {
  useClaudeCodeMessages,
  useClaudeCodeSessions,
  useClaudeCodeStats,
} from "@/hooks/use-claude-code-sessions";
import { useConfig } from "@/hooks/use-config";
import { useProjects } from "@/hooks/use-projects";
import { formatTimeShortJST, getTodayDateString } from "@/lib/date";

interface ClaudeCodeFeedProps {
  className?: string;
}

// デフォルト表示件数
const DEFAULT_PROJECT_LIMIT = 3;
const DEFAULT_SESSION_LIMIT = 3;

export function ClaudeCodeFeed({ className }: ClaudeCodeFeedProps) {
  const date = getTodayDateString();
  const { integrations, loading: configLoading } = useConfig();
  const { sessions, loading, error, syncSessions, syncing } = useClaudeCodeSessions();
  const { stats } = useClaudeCodeStats(date);
  const { projects } = useProjects();
  const { updatePathProject, getPathProjectId } = useClaudeCodePaths();
  const [selectedSession, setSelectedSession] = useState<ClaudeCodeSession | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const activeProjects = projects.filter((p) => p.isActive);

  // プロジェクトの折りたたみを切り替え
  const toggleProjectOpen = (projectPath: string) => {
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  };

  // セッション表示を展開する
  const toggleSessionExpand = (projectPath: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  };

  // Group sessions by project (moved before conditional returns for hooks rules)
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, ClaudeCodeSession[]>();

    for (const session of sessions) {
      const key = session.projectPath;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(session);
      } else {
        grouped.set(key, [session]);
      }
    }

    // Sort sessions within each project by startTime (newest first)
    for (const [, projectSessions] of grouped) {
      projectSessions.sort((a, b) => {
        if (!a.startTime) return 1;
        if (!b.startTime) return -1;
        return b.startTime.localeCompare(a.startTime);
      });
    }

    return grouped;
  }, [sessions]);

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.claudeCode.enabled) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Claude Code
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Settings className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Claude Code 連携は無効化されています</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Settings タブの Integrations で有効にできます
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Claude Code
          </CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Claude Code
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Code className="h-5 w-5" />
          Claude Code
          {stats.totalSessions > 0 && (
            <Badge variant="secondary" className="ml-2">
              {stats.totalSessions} sessions
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={syncSessions}
          disabled={syncing}
          title="Sync sessions"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync"}
        </Button>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Claude Code sessions for this date.</p>
        ) : (
          <div className="space-y-2">
            {(() => {
              const allEntries = Array.from(sessionsByProject.entries());
              const displayEntries = showAllProjects
                ? allEntries
                : allEntries.slice(0, DEFAULT_PROJECT_LIMIT);
              const hasMoreProjects = allEntries.length > DEFAULT_PROJECT_LIMIT;

              return (
                <>
                  {displayEntries.map(([projectPath, projectSessions]) => {
                    const pathProjectId = getPathProjectId(projectPath);
                    const handlePathProjectChange = (value: string) => {
                      const newProjectId = value === "none" ? null : Number(value);
                      const projectName =
                        projectSessions[0]?.projectName ?? projectPath.split("/").pop();
                      updatePathProject(projectPath, newProjectId, projectName ?? undefined);
                    };

                    const isSessionExpanded = expandedSessions.has(projectPath);
                    const displaySessions = isSessionExpanded
                      ? projectSessions
                      : projectSessions.slice(0, DEFAULT_SESSION_LIMIT);
                    const hasMoreSessions = projectSessions.length > DEFAULT_SESSION_LIMIT;
                    const isProjectOpen = openProjects.has(projectPath);

                    return (
                      <Collapsible
                        key={projectPath}
                        open={isProjectOpen}
                        onOpenChange={() => toggleProjectOpen(projectPath)}
                      >
                        <div className="flex items-center gap-2 rounded-md border p-3 hover:bg-muted/50">
                          <CollapsibleTrigger className="flex flex-1 items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {projectSessions[0]?.projectName || projectPath.split("/").pop()}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {projectSessions.length} sessions
                              </Badge>
                            </div>
                            <ChevronDown
                              className={`h-4 w-4 text-muted-foreground transition-transform ${isProjectOpen ? "rotate-180" : ""}`}
                            />
                          </CollapsibleTrigger>
                          {activeProjects.length > 0 && (
                            <Select
                              value={pathProjectId?.toString() ?? "none"}
                              onValueChange={handlePathProjectChange}
                            >
                              <SelectTrigger
                                className="h-7 w-[130px] text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <FolderGit2 className="mr-1 h-3 w-3" />
                                <SelectValue placeholder="Path Project" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">なし</SelectItem>
                                {activeProjects.map((project) => (
                                  <SelectItem key={project.id} value={project.id.toString()}>
                                    {project.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        <CollapsibleContent className="mt-2 space-y-3 pl-4">
                          {displaySessions.map((session) => (
                            <SessionItem
                              key={session.sessionId}
                              session={session}
                              onClick={() => setSelectedSession(session)}
                            />
                          ))}
                          {hasMoreSessions && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full text-muted-foreground"
                              onClick={() => toggleSessionExpand(projectPath)}
                            >
                              <ChevronDown
                                className={`mr-1 h-4 w-4 transition-transform ${isSessionExpanded ? "rotate-180" : ""}`}
                              />
                              {isSessionExpanded
                                ? "閉じる"
                                : `他 ${projectSessions.length - DEFAULT_SESSION_LIMIT} セッションを表示`}
                            </Button>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                  {hasMoreProjects && (
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setShowAllProjects(!showAllProjects)}
                      >
                        <ChevronDown
                          className={`mr-1 h-4 w-4 transition-transform ${showAllProjects ? "rotate-180" : ""}`}
                        />
                        {showAllProjects
                          ? "閉じる"
                          : `他 ${allEntries.length - DEFAULT_PROJECT_LIMIT} プロジェクトを表示`}
                      </Button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </CardContent>

      <SessionMessagesDialog
        session={selectedSession}
        open={selectedSession !== null}
        onOpenChange={(open) => !open && setSelectedSession(null)}
      />
    </Card>
  );
}

interface SessionItemProps {
  session: ClaudeCodeSession;
  onClick: () => void;
}

function SessionItem({ session, onClick }: SessionItemProps) {
  // Format time
  const startTime = session.startTime ? new Date(session.startTime) : null;
  const endTime = session.endTime ? new Date(session.endTime) : null;

  const formatTime = (date: Date | null) => {
    if (!date) return "--:--";
    return formatTimeShortJST(date);
  };

  // Calculate duration
  const duration =
    startTime && endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : null;

  return (
    <div className="rounded-md border p-3 transition-colors hover:bg-muted/50">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {formatTime(startTime)} - {formatTime(endTime)}
          </span>
          {duration !== null && (
            <Badge variant="outline" className="text-xs">
              {duration}min
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="User messages">
            <MessageSquare className="h-3 w-3" />
            {session.userMessageCount}
          </span>
          <span className="flex items-center gap-1" title="Tool uses">
            <Wrench className="h-3 w-3" />
            {session.toolUseCount}
          </span>
        </div>
      </div>
      <button type="button" className="w-full cursor-pointer text-left" onClick={onClick}>
        {session.summary && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{session.summary}</p>
        )}
      </button>
    </div>
  );
}

interface SessionMessagesDialogProps {
  session: ClaudeCodeSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SessionMessagesDialog({ session, open, onOpenChange }: SessionMessagesDialogProps) {
  const { messages, loading } = useClaudeCodeMessages(session?.sessionId ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            {session?.projectName || session?.projectPath.split("/").pop() || "Session"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[60vh]">
          {loading ? (
            <div className="space-y-3 p-4">
              {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
                <Skeleton key={id} className="h-20 w-full" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              No messages found for this session.
            </p>
          ) : (
            <div className="space-y-3 p-4">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

interface MessageBubbleProps {
  message: ClaudeCodeMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        {message.timestamp && (
          <p
            className={`mt-1 text-xs ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}
          >
            {formatTimeShortJST(new Date(message.timestamp))}
          </p>
        )}
      </div>
    </div>
  );
}
