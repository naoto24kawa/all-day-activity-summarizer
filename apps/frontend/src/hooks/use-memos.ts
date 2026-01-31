import type { Memo, MemosResponse } from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteAdasApi, fetchAdasApi, postAdasApi, putAdasApi } from "@/lib/adas-api";

/** 送信中のメモを表す拡張型 */
export interface MemoWithPending extends Memo {
  pending?: boolean;
}

/** ページネーション設定 */
const PAGE_SIZE = 50;

/** メモを createdAt でソート (古い順) */
const sortByCreatedAt = (memos: MemoWithPending[]) =>
  [...memos].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

export function useMemos(date: string) {
  const [memos, setMemos] = useState<MemoWithPending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const tempIdCounter = useRef(-1);
  const offsetRef = useRef(0);

  const fetchMemos = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      // 初回取得は offset=0 で
      const data = await fetchAdasApi<MemosResponse>(`/api/memos?limit=${PAGE_SIZE}&offset=0`);
      offsetRef.current = data.memos.length;
      setTotal(data.total);
      setHasMore(data.hasMore);
      // pending でないメモのみ置き換え、pending メモは保持し、createdAt でソート
      setMemos((prev) => {
        const pendingMemos = prev.filter((m) => m.pending);
        return sortByCreatedAt([...data.memos, ...pendingMemos]);
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch memos");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchMoreMemos = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const data = await fetchAdasApi<MemosResponse>(
        `/api/memos?limit=${PAGE_SIZE}&offset=${offsetRef.current}`,
      );
      offsetRef.current += data.memos.length;
      setTotal(data.total);
      setHasMore(data.hasMore);
      // 既存のメモに追加 (重複を除去してソート)
      setMemos((prev) => {
        const existingIds = new Set(prev.map((m: MemoWithPending) => m.id));
        const newMemos = data.memos.filter((m: Memo) => !existingIds.has(m.id));
        return sortByCreatedAt([...prev, ...newMemos]);
      });
    } catch (err) {
      console.error("Failed to load more memos:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore]);

  useEffect(() => {
    fetchMemos();
    const interval = setInterval(() => fetchMemos(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchMemos]);

  // POST時はdateを渡して当日のメモとして登録 (楽観的更新)
  const postMemo = useCallback(
    async (content: string, tags?: string[], projectId?: number | null) => {
      // 仮IDで即座にUIに反映
      const tempId = tempIdCounter.current--;
      const optimisticMemo: MemoWithPending = {
        id: tempId,
        date,
        content,
        tags: tags ? JSON.stringify(tags) : null,
        projectId: projectId ?? null,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMemos((prev) => sortByCreatedAt([...prev, optimisticMemo]));
      setTotal((prev) => prev + 1);

      try {
        await postAdasApi<Memo>("/api/memos", { content, date, tags, projectId });
        // 成功したらリストを再取得 (pending メモは自動的に置き換わる)
        await fetchMemos(true);
        // pending メモを削除
        setMemos((prev) => prev.filter((m) => m.id !== tempId));
      } catch (err) {
        // 失敗したら pending メモを削除
        setMemos((prev) => prev.filter((m) => m.id !== tempId));
        setTotal((prev) => prev - 1);
        console.error("メモ送信エラー:", err);
      }
    },
    [date, fetchMemos],
  );

  const updateMemo = useCallback(
    async (id: number, content: string, tags?: string[] | null, projectId?: number | null) => {
      await putAdasApi<Memo>(`/api/memos/${id}`, { content, tags, projectId });
      await fetchMemos(true);
    },
    [fetchMemos],
  );

  const deleteMemo = useCallback(
    async (id: number) => {
      await deleteAdasApi<{ success: boolean }>(`/api/memos/${id}`);
      setTotal((prev) => prev - 1);
      await fetchMemos(true);
    },
    [fetchMemos],
  );

  return {
    memos,
    error,
    loading,
    loadingMore,
    hasMore,
    total,
    refetch: fetchMemos,
    fetchMore: fetchMoreMemos,
    postMemo,
    updateMemo,
    deleteMemo,
  };
}
