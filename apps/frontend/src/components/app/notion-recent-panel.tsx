/**
 * Notion Recent Panel Component
 *
 * Displays recent Notion updates in chronological order
 */

import type { NotionItem } from "@repo/types";
import {
  Check,
  CheckCheck,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
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
import { useNotionItems, useNotionUnreadCounts } from "@/hooks/use-notion";
import { getTodayDateString } from "@/lib/date";

interface NotionRecentPanelProps {
  className?: string;
}

const INITIAL_LIMIT = 5;
const LOAD_MORE_COUNT = 5;

export function NotionRecentPanel({ className }: NotionRecentPanelProps) {
  const date = getTodayDateString();
  const { integrations, loading: configLoading } = useConfig();
  const { items, loading, error, refetch, markAsRead, markAllAsRead } = useNotionItems();
  const { counts } = useNotionUnreadCounts(date);
  const [limit, setLimit] = useState(INITIAL_LIMIT);

  // 未読アイテムを最新順にソート
  const unreadItems = useMemo(() => {
    return [...items]
      .filter((item) => !item.isRead)
      .sort((a, b) => {
        return new Date(b.lastEditedTime).getTime() - new Date(a.lastEditedTime).getTime();
      });
  }, [items]);

  const displayedItems = unreadItems.slice(0, limit);
  const hasMore = unreadItems.length > limit;

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

  // 連携が無効でデータもない場合
  if (!configLoading && integrations && !integrations.notion?.enabled && unreadItems.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-blue-500" />
            Recent Updates
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6">
          <Settings className="mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Notion 連携は無効化されています</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-blue-500" />
            Recent Updates
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
            <Sparkles className="h-4 w-4 text-blue-500" />
            Recent Updates
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
          <Sparkles className="h-4 w-4 text-blue-500" />
          Recent Updates
          {counts.total > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            >
              {counts.total} unread
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-1">
          {counts.total > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => markAllAsRead({ date })}
              title="Mark all as read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
        {unreadItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground">
            <Check className="mb-2 h-8 w-8" />
            <p className="text-sm">未読の更新はありません</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-3">
              {displayedItems.map((item) => (
                <RecentNotionItem key={item.id} item={item} onMarkAsRead={markAsRead} />
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

function RecentNotionItem({
  item,
  onMarkAsRead,
}: {
  item: NotionItem;
  onMarkAsRead: (id: number) => void;
}) {
  // 日時フォーマット
  const formattedDate = new Date(item.lastEditedTime).toLocaleString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-2 rounded-md border border-l-4 border-l-blue-500 bg-blue-50/50 p-2 dark:bg-blue-950/20">
      <div className="mt-0.5 shrink-0">
        {item.databaseId ? (
          <Database className="h-3.5 w-3.5 text-blue-500" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-blue-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {item.icon && <span className="text-sm">{item.icon}</span>}
          <span className="flex items-center gap-0.5 opacity-60">
            <Clock className="h-3 w-3" />
            {formattedDate}
          </span>
          {item.lastEditedBy && <span className="font-medium">by {item.lastEditedBy}</span>}
        </div>
        <p className="line-clamp-2 text-sm">{item.title}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.url && (
          <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onMarkAsRead(item.id)}
          title="Mark as read"
        >
          <Check className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
