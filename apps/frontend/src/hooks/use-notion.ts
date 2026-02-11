/**
 * Notion Hooks
 */

import type { NotionDatabase, NotionItem, NotionUnreadCounts } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export function useNotionItems() {
  const [items, setItems] = useState<NotionItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetchAdasApi<{ data: NotionItem[]; totalCount: number }>(
        "/api/notion-items",
      );
      setItems(res.data);
      setTotalCount(res.totalCount);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Notion items");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const markAsRead = useCallback(
    async (id: number) => {
      await fetch(`${ADAS_API_URL}/api/notion-items/${id}/read`, { method: "PATCH" });
      await fetchItems(true);
    },
    [fetchItems],
  );

  const markAllAsRead = useCallback(
    async (options?: { date?: string; databaseId?: string }) => {
      await postAdasApi("/api/notion-items/mark-all-read", options || {});
      await fetchItems(true);
    },
    [fetchItems],
  );

  return { items, totalCount, error, loading, refetch: fetchItems, markAsRead, markAllAsRead };
}

export function useNotionUnreadCounts(date?: string) {
  const [counts, setCounts] = useState<NotionUnreadCounts>({
    total: 0,
    database: 0,
    page: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const data = await fetchAdasApi<NotionUnreadCounts>(
        `/api/notion-items/unread-count?${params}`,
      );
      setCounts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch unread counts");
    }
  }, [date]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  return { counts, error, refetch: fetchCounts };
}

export function useNotionDatabases() {
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDatabases = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<NotionDatabase[]>("/api/notion-databases");
      setDatabases(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Notion databases");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDatabases();
  }, [fetchDatabases]);

  const addDatabase = useCallback(
    async (databaseId: string, title?: string, projectId?: number) => {
      await postAdasApi("/api/notion-databases", { databaseId, title, projectId });
      await fetchDatabases(true);
    },
    [fetchDatabases],
  );

  return { databases, error, loading, refetch: fetchDatabases, addDatabase };
}
