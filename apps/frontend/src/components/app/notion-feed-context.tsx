/**
 * Notion Feed Context
 *
 * NotionFeed と NotionRecentPanel で状態を共有するための Context
 */

import type { NotionDatabase, NotionItem, Project } from "@repo/types";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { useNotionDatabases, useNotionItems, useNotionUnreadCounts } from "@/hooks/use-notion";
import { useProjects } from "@/hooks/use-projects";
import { getTodayDateString } from "@/lib/date";

interface NotionFeedContextValue {
  // データ
  date: string;
  items: NotionItem[];
  unreadItems: NotionItem[];
  loading: boolean;
  error: string | null;
  counts: { total: number; database: number; page: number };
  databases: NotionDatabase[];
  databaseMap: Map<string, NotionDatabase>;
  projects: Project[];
  activeProjects: Project[];

  // アクション
  refetch: () => void;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: (params?: { date?: string; databaseId?: string }) => Promise<void>;
  refetchUnreadCounts: () => void;
}

const NotionFeedContext = createContext<NotionFeedContextValue | null>(null);

export function NotionFeedProvider({ children }: { children: ReactNode }) {
  const date = getTodayDateString();
  const { items, loading, error, refetch, markAsRead, markAllAsRead } = useNotionItems();
  const { counts, refetch: refetchUnreadCounts } = useNotionUnreadCounts(date);
  const { databases } = useNotionDatabases();
  const { projects: allProjects } = useProjects(false);

  // アクティブなプロジェクト一覧
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

  // 未読アイテムを最新順にソート
  const unreadItems = useMemo(() => {
    return [...items]
      .filter((item) => !item.isRead)
      .sort((a, b) => {
        return new Date(b.lastEditedTime).getTime() - new Date(a.lastEditedTime).getTime();
      });
  }, [items]);

  // 両方のパネルから呼べるように refetch を拡張
  const handleRefetch = useCallback(() => {
    refetch();
    refetchUnreadCounts();
    // NotionRecentPanel にも更新を通知
    window.dispatchEvent(new CustomEvent("notion-refresh"));
  }, [refetch, refetchUnreadCounts]);

  // feeds-refresh (統一更新) と notion-refresh (個別) をリッスン
  useEffect(() => {
    const handleFeedsRefresh = () => handleRefetch();
    window.addEventListener("feeds-refresh", handleFeedsRefresh);
    return () => window.removeEventListener("feeds-refresh", handleFeedsRefresh);
  }, [handleRefetch]);

  const value: NotionFeedContextValue = {
    date,
    items,
    unreadItems,
    loading,
    error,
    counts,
    databases,
    databaseMap,
    projects: allProjects,
    activeProjects,
    refetch: handleRefetch,
    markAsRead,
    markAllAsRead,
    refetchUnreadCounts,
  };

  return <NotionFeedContext.Provider value={value}>{children}</NotionFeedContext.Provider>;
}

export function useNotionFeedContext() {
  const context = useContext(NotionFeedContext);
  if (!context) {
    throw new Error("useNotionFeedContext must be used within a NotionFeedProvider");
  }
  return context;
}
