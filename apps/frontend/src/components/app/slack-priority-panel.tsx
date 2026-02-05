/**
 * Slack Priority Panel Component
 *
 * Displays priority Slack messages that need attention
 */

import type { SlackMessage, SlackMessagePriority } from "@repo/types";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  AtSign,
  Check,
  ExternalLink,
  Hash,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { useSlackMessages } from "@/hooks/use-slack-messages";
import { formatSlackTsJST } from "@/lib/date";

interface SlackPriorityPanelProps {
  className?: string;
}

const INITIAL_LIMIT = 5;
const LOAD_MORE_COUNT = 5;

export function SlackPriorityPanel({ className }: SlackPriorityPanelProps) {
  const { integrations, loading: configLoading } = useConfig();
  const { messages, loading, error, refetch, markAsRead } = useSlackMessages();
  const [limit, setLimit] = useState(INITIAL_LIMIT);

  // 優先度の高い未読メッセージ (全件)
  const allPriorityMessages = useMemo(() => {
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return messages
      .filter((m) => m.priority !== null && !m.isRead)
      .sort((a, b) => {
        const orderA = priorityOrder[a.priority ?? ""] ?? 3;
        const orderB = priorityOrder[b.priority ?? ""] ?? 3;
        return orderA - orderB;
      });
  }, [messages]);

  const displayedMessages = allPriorityMessages.slice(0, limit);
  const hasMore = allPriorityMessages.length > limit;

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
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.slack.enabled) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Priority Messages
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6">
          <Settings className="mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Slack 連携は無効化されています</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Priority Messages
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
            <Sparkles className="h-4 w-4 text-amber-500" />
            Priority Messages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex flex-col ${className ?? ""}`}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Priority Messages
          {allPriorityMessages.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
            >
              {allPriorityMessages.length}
            </Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
        {allPriorityMessages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground">
            <Check className="mb-2 h-8 w-8" />
            <p className="text-sm">優先度の高い未読メッセージはありません</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-3">
              {displayedMessages.map((message) => (
                <PriorityMessageItem key={message.id} message={message} onMarkAsRead={markAsRead} />
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
    </Card>
  );
}

function PriorityMessageItem({
  message,
  onMarkAsRead,
}: {
  message: SlackMessage;
  onMarkAsRead: (id: number) => void;
}) {
  const getPriorityIcon = (p: SlackMessagePriority | null) => {
    switch (p) {
      case "high":
        return <AlertTriangle className="h-3 w-3 text-red-500" />;
      case "medium":
        return <ArrowRight className="h-3 w-3 text-yellow-500" />;
      case "low":
        return <ArrowDown className="h-3 w-3 text-green-500" />;
      default:
        return null;
    }
  };

  const getMessageTypeIcon = (type: string | null) => {
    switch (type) {
      case "mention":
        return <AtSign className="h-3 w-3" />;
      case "channel":
        return <Hash className="h-3 w-3" />;
      case "dm":
        return <MessageSquare className="h-3 w-3" />;
      case "keyword":
        return <Search className="h-3 w-3" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`flex items-start gap-2 rounded-md border p-2 ${
        message.priority === "high"
          ? "border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20"
          : message.priority === "medium"
            ? "border-l-4 border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20"
            : "border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-950/20"
      }`}
    >
      <div className="mt-0.5 shrink-0">{getPriorityIcon(message.priority)}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-0.5">
            {getMessageTypeIcon(message.messageType)}
            {message.messageType === "dm" ? message.channelName : `#${message.channelName}`}
          </span>
          {message.userName && (
            <span className="flex items-center gap-0.5 font-medium">@{message.userName}</span>
          )}
          <span className="opacity-60">{formatSlackTsJST(message.messageTs)}</span>
        </div>
        <p className="line-clamp-2 text-sm">{message.text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {message.permalink && (
          <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
            <a href={message.permalink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onMarkAsRead(message.id)}
          title="Mark as read"
        >
          <Check className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
