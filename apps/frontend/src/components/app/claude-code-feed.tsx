/**
 * Claude Code Feed Component
 *
 * Displays Claude Code sessions grouped by project
 */

import type { ClaudeCodeSession } from "@repo/types";
import { Code, FolderGit2, MessageSquare, RefreshCw, Wrench } from "lucide-react";
import { useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useClaudeCodeSessions, useClaudeCodeStats } from "@/hooks/use-claude-code-sessions";
import { formatTimeShortJST } from "@/lib/date";

interface ClaudeCodeFeedProps {
  date: string;
}

export function ClaudeCodeFeed({ date }: ClaudeCodeFeedProps) {
  const { sessions, loading, error, syncSessions } = useClaudeCodeSessions(date);
  const { stats } = useClaudeCodeStats(date);

  // Group sessions by project
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Code className="h-5 w-5" />
          Claude Code
          {stats.totalSessions > 0 && (
            <Badge variant="secondary" className="ml-2">
              {stats.totalSessions} sessions
            </Badge>
          )}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={syncSessions} title="Sync sessions">
          <RefreshCw className="mr-1 h-3 w-3" />
          Sync
        </Button>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Claude Code sessions for this date.</p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {Array.from(sessionsByProject.entries()).map(([projectPath, projectSessions]) => (
              <AccordionItem key={projectPath} value={projectPath}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {projectSessions[0]?.projectName || projectPath.split("/").pop()}
                    </span>
                    <Badge variant="outline" className="ml-2">
                      {projectSessions.length} sessions
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pl-6">
                    {projectSessions.map((session) => (
                      <SessionItem key={session.sessionId} session={session} />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function SessionItem({ session }: { session: ClaudeCodeSession }) {
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
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
      {session.summary && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{session.summary}</p>
      )}
    </div>
  );
}
