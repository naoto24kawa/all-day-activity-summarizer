/**
 * Notion Feed Component
 *
 * Notion データベースアイテムとページを表示
 */

import type { NotionDatabase, NotionItem, Project } from "@repo/types";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  NotebookPen,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { useNotionDatabases, useNotionItems, useNotionUnreadCounts } from "@/hooks/use-notion";
import { useProjects } from "@/hooks/use-projects";
import { getTodayDateString } from "@/lib/date";

interface NotionFeedProps {
  className?: string;
}

export function NotionFeed({ className }: NotionFeedProps) {
  const date = getTodayDateString();
  const { integrations, loading: configLoading } = useConfig();
  const { items, loading, error, refetch, markAsRead, markAllAsRead } = useNotionItems();
  const { counts } = useNotionUnreadCounts(date);
  const { databases } = useNotionDatabases();

  // プロジェクト管理
  const { projects: allProjects } = useProjects(false);

  // アクティブなプロジェクト一覧 (紐付け先選択用)
  const activeProjects = useMemo(
    () => allProjects.filter((p) => p.isActive && !p.excludedAt),
    [allProjects],
  );

  // databaseId → database info のマップ
  const databaseMap = useMemo(() => {
    const map = new Map<string, NotionDatabase>();
    for (const db of databases) {
      map.set(db.databaseId, db);
    }
    return map;
  }, [databases]);

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.notion?.enabled) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NotebookPen className="h-5 w-5" />
            Notion
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Settings className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Notion 連携は無効化されています</p>
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
            <NotebookPen className="h-5 w-5" />
            Notion
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
            <NotebookPen className="h-5 w-5" />
            Notion
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
          <NotebookPen className="h-5 w-5" />
          Notion
          {counts.total > 0 && (
            <Badge variant="destructive" className="ml-1">
              {counts.total} unread
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {counts.total > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllAsRead({ date })}>
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Notion activity.</p>
        ) : (
          <DatabaseGroupedItemList
            items={items}
            databaseMap={databaseMap}
            activeProjects={activeProjects}
            onMarkAsRead={markAsRead}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** データベース別グループ */
interface DatabaseGroup {
  databaseId: string | null;
  databaseTitle: string;
  databaseIcon: string | null;
  items: NotionItem[];
  unreadCount: number;
}

function DatabaseGroupedItemList({
  items,
  databaseMap,
  activeProjects,
  onMarkAsRead,
}: {
  items: NotionItem[];
  databaseMap: Map<string, NotionDatabase>;
  activeProjects: Project[];
  onMarkAsRead: (id: number) => void;
}) {
  // データベース別にグループ化
  const groups = useMemo((): DatabaseGroup[] => {
    const groupMap = new Map<string | null, NotionItem[]>();

    for (const item of items) {
      const key = item.databaseId;
      const existing = groupMap.get(key) ?? [];
      existing.push(item);
      groupMap.set(key, existing);
    }

    const result: DatabaseGroup[] = [];

    for (const [databaseId, groupItems] of groupMap.entries()) {
      const dbInfo = databaseId ? databaseMap.get(databaseId) : null;
      result.push({
        databaseId,
        databaseTitle: dbInfo?.title ?? (databaseId ? "Unknown Database" : "Pages"),
        databaseIcon: dbInfo?.icon ?? null,
        items: groupItems,
        unreadCount: groupItems.filter((i) => !i.isRead).length,
      });
    }

    // データベース名でソート (Pages は最後)
    result.sort((a, b) => {
      if (a.databaseId === null) return 1;
      if (b.databaseId === null) return -1;
      return a.databaseTitle.localeCompare(b.databaseTitle);
    });

    return result;
  }, [items, databaseMap]);

  // 開閉状態を管理
  const [openGroups, setOpenGroups] = useState<Set<string | null>>(() => {
    const initial = new Set<string | null>();
    for (const g of groups) {
      initial.add(g.databaseId);
    }
    return initial;
  });

  const toggleGroup = (databaseId: string | null) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(databaseId)) {
        next.delete(databaseId);
      } else {
        next.add(databaseId);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No items.</p>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {groups.map((group) => (
          <DatabaseCollapsible
            key={group.databaseId ?? "pages"}
            group={group}
            isOpen={openGroups.has(group.databaseId)}
            onToggle={() => toggleGroup(group.databaseId)}
            onMarkAsRead={onMarkAsRead}
          />
        ))}
      </div>
    </div>
  );
}

function DatabaseCollapsible({
  group,
  isOpen,
  onToggle,
  onMarkAsRead,
}: {
  group: DatabaseGroup;
  isOpen: boolean;
  onToggle: () => void;
  onMarkAsRead: (id: number) => void;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="flex items-center gap-2 rounded-md border p-2 hover:bg-muted/50">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          {group.databaseId ? (
            <Database className="h-4 w-4 text-muted-foreground" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
          {group.databaseIcon && <span className="text-sm">{group.databaseIcon}</span>}
          <span className="truncate text-sm font-medium">{group.databaseTitle}</span>
          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
            {group.items.length}
          </Badge>
          {group.unreadCount > 0 && (
            <Badge variant="destructive" className="h-5 px-1.5 text-xs">
              {group.unreadCount} unread
            </Badge>
          )}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 pl-6">
          {group.items.map((item) => (
            <NotionItemCard key={item.id} item={item} onMarkAsRead={onMarkAsRead} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NotionItemCard({
  item,
  onMarkAsRead,
}: {
  item: NotionItem;
  onMarkAsRead: (id: number) => void;
}) {
  // プロパティをパース
  const properties = useMemo(() => {
    if (!item.properties) return null;
    try {
      return JSON.parse(item.properties) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [item.properties]);

  // Status プロパティがあれば表示
  const status = properties?.Status as string | null | undefined;

  // 日時フォーマット
  const formattedDate = new Date(item.lastEditedTime).toLocaleString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`rounded-md border p-3 ${item.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {item.icon && <span className="text-base">{item.icon}</span>}
          <span className="text-xs text-muted-foreground">{formattedDate}</span>
          {item.lastEditedBy && (
            <span className="text-xs text-muted-foreground">by {item.lastEditedBy}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {item.url && (
            <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          {!item.isRead && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onMarkAsRead(item.id)}
              title="Mark as read"
            >
              <Check className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="mb-2 text-sm font-medium">{item.title}</p>
      <div className="flex flex-wrap items-center gap-1">
        {status && (
          <Badge variant="outline" className="text-xs">
            {status}
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs">
          {item.parentType}
        </Badge>
      </div>
    </div>
  );
}
