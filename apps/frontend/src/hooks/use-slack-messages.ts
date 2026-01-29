/**
 * Slack Messages Hook
 */

import type { SlackMessage } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export interface SlackUnreadCounts {
  total: number;
  mention: number;
  channel: number;
  dm: number;
}

export function useSlackMessages(date?: string) {
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (date) params.set("date", date);

        const data = await fetchAdasApi<SlackMessage[]>(`/api/slack-messages?${params}`);
        setMessages(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch Slack messages");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(() => fetchMessages(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const markAsRead = useCallback(
    async (id: number) => {
      await fetch(`${ADAS_API_URL}/api/slack-messages/${id}/read`, { method: "PATCH" });
      await fetchMessages(true);
    },
    [fetchMessages],
  );

  const markAllAsRead = useCallback(
    async (options?: { date?: string; type?: "mention" | "channel" | "dm" }) => {
      await postAdasApi("/api/slack-messages/mark-all-read", options || {});
      await fetchMessages(true);
    },
    [fetchMessages],
  );

  return { messages, error, loading, refetch: fetchMessages, markAsRead, markAllAsRead };
}

export function useSlackUnreadCounts(date?: string) {
  const [counts, setCounts] = useState<SlackUnreadCounts>({
    total: 0,
    mention: 0,
    channel: 0,
    dm: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const data = await fetchAdasApi<SlackUnreadCounts>(
        `/api/slack-messages/unread-count?${params}`,
      );
      setCounts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch unread counts");
    }
  }, [date]);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, 30_000);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  return { counts, error, refetch: fetchCounts };
}
