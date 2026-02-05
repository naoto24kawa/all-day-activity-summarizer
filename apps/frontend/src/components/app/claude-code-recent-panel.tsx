/**
 * Claude Code Recent Panel Component
 *
 * Displays recent Claude Code sessions and interactions
 */

import type { ClaudeCodeMessage, ClaudeCodeSession } from "@repo/types";
import {
  Check,
  Clock,
  Code,
  Loader2,
  MessageSquare,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useClaudeCodeMessages, useClaudeCodeSessions } from "@/hooks/use-claude-code-sessions";
import { useConfig } from "@/hooks/use-config";
import { formatTimeShortJST } from "@/lib/date";

interface ClaudeCodeRecentPanelProps {
  className?: string;
}

const INITIAL_LIMIT = 15;
const LOAD_MORE_COUNT = 10;

export function ClaudeCodeRecentPanel({ className }: ClaudeCodeRecentPanelProps) {
  const { integrations, loading: configLoading } = useConfig();
  const { sessions, loading, error, refetch } = useClaudeCodeSessions();
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [selectedSession, setSelectedSession] = useState<ClaudeCodeSession | null>(null);

  // 最新のセッション順にソート
  const recentSessions = useMemo(() => {
    return [...sessions]
      .filter((s) => s.startTime)
      .sort((a, b) => {
        if (!a.startTime) return 1;
        if (!b.startTime) return -1;
        return b.startTime.localeCompare(a.startTime);
      });
  }, [sessions]);

  const displayedSessions = recentSessions.slice(0, limit);
  const hasMore = recentSessions.length > limit;

  // 無限スクロール用の sentinel ref
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    if (hasMore) {
      setLimit((prev) => prev + LOAD_MORE_COUNT);
    }
  }, [hasMore]);

  // IntersectionObserver で sentinel が見えたら自動読み込み
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // feeds-refresh (統一更新) をリッスン
  useEffect(() => {
    const handleRefresh = () => refetch();
    window.addEventListener("feeds-refresh", handleRefresh);
    return () => window.removeEventListener("feeds-refresh", handleRefresh);
  }, [refetch]);

  // 連携が無効でデータもない場合
  if (
    !configLoading &&
    integrations &&
    !integrations.claudeCode?.enabled &&
    recentSessions.length === 0
  ) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Recent Sessions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6">
          <Settings className="mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Claude Code 連携は無効化されています</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Recent Sessions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Recent Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="shrink-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-purple-500" />
          Recent Sessions
          {recentSessions.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
            >
              {recentSessions.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
        {recentSessions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground">
            <Check className="mb-2 h-8 w-8" />
            <p className="text-sm">最近のセッションはありません</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-3">
              {displayedSessions.map((session) => (
                <RecentSessionItem
                  key={session.sessionId}
                  session={session}
                  onClick={() => setSelectedSession(session)}
                />
              ))}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-3 text-xs text-muted-foreground"
                >
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  読み込み中...
                </div>
              )}
            </div>
          </ScrollArea>
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

function RecentSessionItem({
  session,
  onClick,
}: {
  session: ClaudeCodeSession;
  onClick: () => void;
}) {
  const startTime = session.startTime ? new Date(session.startTime) : null;
  const endTime = session.endTime ? new Date(session.endTime) : null;

  // Calculate duration
  const duration =
    startTime && endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : null;

  const projectName = session.projectName || session.projectPath.split("/").pop() || "Unknown";

  return (
    <button
      type="button"
      className="w-full cursor-pointer rounded-md border border-l-4 border-l-purple-500 bg-purple-50/50 p-2 text-left transition-colors hover:bg-purple-100/50 dark:bg-purple-950/20 dark:hover:bg-purple-950/40"
      onClick={onClick}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-0.5 font-medium">
          <Code className="h-3 w-3" />
          {projectName}
        </span>
        {startTime && (
          <span className="flex items-center gap-0.5 opacity-60">
            <Clock className="h-3 w-3" />
            {formatTimeShortJST(startTime)}
          </span>
        )}
        {duration !== null && (
          <Badge variant="outline" className="h-4 px-1 text-xs">
            {duration}min
          </Badge>
        )}
      </div>
      {session.summary ? (
        <p className="line-clamp-2 text-sm">{session.summary}</p>
      ) : (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {session.userMessageCount} messages
          </span>
          <span className="flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            {session.toolUseCount} tools
          </span>
        </div>
      )}
    </button>
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

function MessageBubble({ message }: { message: ClaudeCodeMessage }) {
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
