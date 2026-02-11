/**
 * Claude Code Feed Component
 *
 * Displays Claude Code sessions grouped by project
 * Stats for initial display, sessions fetched on expand
 */

import type { ClaudeCodeMessage, ClaudeCodeSession } from "@repo/types";
import { ChevronDown, Code, FolderGit2, MessageSquare, Settings, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  type ClaudeCodeStats,
  useClaudeCodeMessages,
  useClaudeCodeProjectSessions,
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
  const { syncing, syncSessions } = useClaudeCodeSessions();
  const { stats, refetch: refetchStats } = useClaudeCodeStats(date);
  const { projects } = useProjects();
  const { updatePathProject, getPathProjectId } = useClaudeCodePaths();
  const [selectedSession, setSelectedSession] = useState<ClaudeCodeSession | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);
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

  // feeds-refresh / claude-refresh をリッスン
  const handleRefresh = useCallback(() => {
    syncSessions();
    refetchStats();
  }, [syncSessions, refetchStats]);

  useEffect(() => {
    window.addEventListener("feeds-refresh", handleRefresh);
    window.addEventListener("claude-refresh", handleRefresh);
    return () => {
      window.removeEventListener("feeds-refresh", handleRefresh);
      window.removeEventListener("claude-refresh", handleRefresh);
    };
  }, [handleRefresh]);

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.claudeCode.enabled) {
    return (
      <Card className={className}>
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

  if (syncing && stats.totalSessions === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ""}`}>
      {stats.totalSessions > 0 && (
        <CardHeader className="shrink-0 py-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{stats.totalSessions} sessions</Badge>
          </div>
        </CardHeader>
      )}
      <CardContent className="min-h-0 flex-1 overflow-auto">
        {stats.projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Claude Code sessions for this date.</p>
        ) : (
          <div className="space-y-2">
            {(() => {
              const displayProjects = showAllProjects
                ? stats.projects
                : stats.projects.slice(0, DEFAULT_PROJECT_LIMIT);
              const hasMoreProjects = stats.projects.length > DEFAULT_PROJECT_LIMIT;

              return (
                <>
                  {displayProjects.map((project) => {
                    const pathProjectId = getPathProjectId(project.projectPath);
                    const handlePathProjectChange = (value: string) => {
                      const newProjectId = value === "none" ? null : Number(value);
                      const projectName =
                        project.projectName ?? project.projectPath.split("/").pop();
                      updatePathProject(
                        project.projectPath,
                        newProjectId,
                        projectName ?? undefined,
                      );
                    };

                    const isProjectOpen = openProjects.has(project.projectPath);

                    return (
                      <Collapsible
                        key={project.projectPath}
                        open={isProjectOpen}
                        onOpenChange={() => toggleProjectOpen(project.projectPath)}
                      >
                        <div className="flex items-center gap-2 rounded-md border p-3 hover:bg-muted/50">
                          <CollapsibleTrigger className="flex flex-1 items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {project.projectName || project.projectPath.split("/").pop()}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {project.sessionCount} sessions
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
                                {activeProjects.map((p) => (
                                  <SelectItem key={p.id} value={p.id.toString()}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        <CollapsibleContent className="mt-2 space-y-3 pl-4">
                          {isProjectOpen && (
                            <ProjectSessions
                              projectPath={project.projectPath}
                              onSelectSession={setSelectedSession}
                            />
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
                          : `他 ${stats.projects.length - DEFAULT_PROJECT_LIMIT} プロジェクトを表示`}
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

/** プロジェクト展開時のセッション一覧 (展開時に取得) */
function ProjectSessions({
  projectPath,
  onSelectSession,
}: {
  projectPath: string;
  onSelectSession: (session: ClaudeCodeSession) => void;
}) {
  const { sessions, loading } = useClaudeCodeProjectSessions(projectPath);
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="space-y-2">
        {["s1", "s2", "s3"].map((id) => (
          <Skeleton key={id} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return <p className="py-2 text-center text-sm text-muted-foreground">No sessions.</p>;
  }

  const displaySessions = expanded ? sessions : sessions.slice(0, DEFAULT_SESSION_LIMIT);
  const hasMore = sessions.length > DEFAULT_SESSION_LIMIT;

  return (
    <>
      {displaySessions.map((session) => (
        <SessionItem
          key={session.sessionId}
          session={session}
          onClick={() => onSelectSession(session)}
        />
      ))}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown
            className={`mr-1 h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "閉じる" : `他 ${sessions.length - DEFAULT_SESSION_LIMIT} セッションを表示`}
        </Button>
      )}
    </>
  );
}

interface SessionItemProps {
  session: ClaudeCodeSession;
  onClick: () => void;
}

function SessionItem({ session, onClick }: SessionItemProps) {
  const startTime = session.startTime ? new Date(session.startTime) : null;
  const endTime = session.endTime ? new Date(session.endTime) : null;

  const formatTime = (date: Date | null) => {
    if (!date) return "--:--";
    return formatTimeShortJST(date);
  };

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
