import type { Memo } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "./use-adas-api";

export function useMemos(date: string) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMemos = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const data = await fetchAdasApi<Memo[]>(`/api/memos?date=${date}`);
        setMemos(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch memos");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchMemos();
    const interval = setInterval(() => fetchMemos(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchMemos]);

  const postMemo = useCallback(
    async (content: string) => {
      await postAdasApi<Memo>("/api/memos", { content, date });
      await fetchMemos(true);
    },
    [date, fetchMemos],
  );

  return { memos, error, loading, refetch: fetchMemos, postMemo };
}
