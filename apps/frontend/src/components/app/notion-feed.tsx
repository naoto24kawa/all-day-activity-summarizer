/**
 * Notion Feed Component
 *
 * Notion データベースアイテムとページを表示
 */

import type { NotionDatabase, NotionItem } from "@repo/types";
import {
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { useNotionFeedContext } from "./notion-feed-context";

interface NotionFeedProps {
  className?: string;
}

export function NotionFeed({ className }: NotionFeedProps) {
  const { integrations, loading: configLoading } = useConfig();
  const { items, loading, error, databaseMap } = useNotionFeedContext();

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 pt-6">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.notion?.enabled && items.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-muted-foreground" />
            Databases
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

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Notion activity.</p>
        ) : (
          <DatabaseGroupedItemList items={items} databaseMap={databaseMap} />
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
}

function DatabaseGroupedItemList({
  items,
  databaseMap,
}: {
  items: NotionItem[];
  databaseMap: Map<string, NotionDatabase>;
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

  // 開閉状態を管理 (初期状態は全て閉じている)
  const [openGroups, setOpenGroups] = useState<Set<string | null>>(() => new Set<string | null>());

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
}: {
  group: DatabaseGroup;
  isOpen: boolean;
  onToggle: () => void;
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
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 pl-6">
          {group.items.map((item) => (
            <NotionItemCard key={item.id} item={item} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NotionItemCard({ item }: { item: NotionItem }) {
  const [isContentOpen, setIsContentOpen] = useState(false);

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
    <div className="rounded-md border p-3">
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
      {/* 本文表示 */}
      {item.content && (
        <Collapsible open={isContentOpen} onOpenChange={setIsContentOpen} className="mt-2">
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {isContentOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            本文を表示
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">
              {item.content}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
