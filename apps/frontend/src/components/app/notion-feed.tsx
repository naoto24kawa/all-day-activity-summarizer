/**
 * Notion Feed Component
 *
 * Notion データベースアイテムとページを表示
 * Summary + expand-on-demand pattern: DB一覧を初期表示、展開時にアイテム取得
 */

import type { NotionItem } from "@repo/types";
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
import { type NotionDatabaseSummary, useNotionDatabaseItems } from "@/hooks/use-notion";
import { useNotionFeedContext } from "./notion-feed-context";

interface NotionFeedProps {
  className?: string;
}

export function NotionFeed({ className }: NotionFeedProps) {
  const { integrations, loading: configLoading } = useConfig();
  const { databaseSummaries, summaryLoading, summaryError } = useNotionFeedContext();

  if (summaryLoading) {
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

  if (summaryError) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{summaryError}</p>
        </CardContent>
      </Card>
    );
  }

  // 連携が無効な場合
  if (
    !configLoading &&
    integrations &&
    !integrations.notion?.enabled &&
    databaseSummaries.length === 0
  ) {
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
        {databaseSummaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Notion activity.</p>
        ) : (
          <DatabaseSummaryList databases={databaseSummaries} />
        )}
      </CardContent>
    </Card>
  );
}

/** データベース一覧 (summary ベース) */
function DatabaseSummaryList({ databases }: { databases: NotionDatabaseSummary[] }) {
  const sorted = useMemo(() => {
    return [...databases].sort((a, b) => {
      if (a.databaseId === null) return 1;
      if (b.databaseId === null) return -1;
      return a.databaseTitle.localeCompare(b.databaseTitle);
    });
  }, [databases]);

  const [openGroups, setOpenGroups] = useState<Set<string | null>>(new Set());

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

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {sorted.map((db) => (
          <DatabaseCollapsible
            key={db.databaseId ?? "pages"}
            database={db}
            isOpen={openGroups.has(db.databaseId)}
            onToggle={() => toggleGroup(db.databaseId)}
          />
        ))}
      </div>
    </div>
  );
}

/** データベース行 (折りたたみ) - 展開時にアイテム取得 */
function DatabaseCollapsible({
  database,
  isOpen,
  onToggle,
}: {
  database: NotionDatabaseSummary;
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
          {database.databaseId ? (
            <Database className="h-4 w-4 text-muted-foreground" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
          {database.databaseIcon && <span className="text-sm">{database.databaseIcon}</span>}
          <span className="truncate text-sm font-medium">{database.databaseTitle}</span>
          <span className="text-xs text-muted-foreground">({database.itemCount})</span>
          {database.unreadCount > 0 && (
            <Badge variant="default" className="text-xs">
              {database.unreadCount}
            </Badge>
          )}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 pl-6">
          {isOpen && <DatabaseItems databaseId={database.databaseId} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** データベース展開時のアイテム一覧 (展開時に取得) */
function DatabaseItems({ databaseId }: { databaseId: string | null }) {
  // null = Pages (DB未所属) → 空文字を渡すとhookが noDatabaseId=true で取得
  const { items, loading } = useNotionDatabaseItems(databaseId ?? "");

  if (loading) {
    return (
      <div className="space-y-2">
        {["s1", "s2", "s3"].map((id) => (
          <Skeleton key={id} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="py-2 text-center text-sm text-muted-foreground">No items.</p>;
  }

  return (
    <>
      {items.map((item) => (
        <NotionItemCard key={item.id} item={item} />
      ))}
    </>
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
