/**
 * Slack Messages Hook
 */

import type { SlackMessage, SlackMessagePriority, SlackPriorityCounts } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export interface SlackUnreadCounts {
  total: number;
  mention: number;
  channel: number;
  dm: number;
  keyword: number;
}

export function useSlackMessages() {
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingAllAsRead, setMarkingAllAsRead] = useState(false);

  const fetchMessages = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetchAdasApi<{ data: SlackMessage[]; totalCount: number }>(
        "/api/slack-messages",
      );
      setMessages(res.data);
      setTotalCount(res.totalCount);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Slack messages");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
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
      setMarkingAllAsRead(true);
      try {
        await postAdasApi("/api/slack-messages/mark-all-read", options || {});
        await fetchMessages(true);
      } finally {
        setMarkingAllAsRead(false);
      }
    },
    [fetchMessages],
  );

  const updateMessage = useCallback(
    async (id: number, data: { projectId?: number | null }) => {
      await fetch(`${ADAS_API_URL}/api/slack-messages/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await fetchMessages(true);
    },
    [fetchMessages],
  );

  const updatePriority = useCallback(
    async (id: number, priority: SlackMessagePriority) => {
      await fetch(`${ADAS_API_URL}/api/slack-messages/${id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      await fetchMessages(true);
    },
    [fetchMessages],
  );

  return {
    messages,
    totalCount,
    error,
    loading,
    markingAllAsRead,
    refetch: fetchMessages,
    markAsRead,
    markAllAsRead,
    updateMessage,
    updatePriority,
  };
}

export function useSlackUnreadCounts(date?: string) {
  const [counts, setCounts] = useState<SlackUnreadCounts>({
    total: 0,
    mention: 0,
    channel: 0,
    dm: 0,
    keyword: 0,
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
  }, [fetchCounts]);

  return { counts, error, refetch: fetchCounts };
}

export function useSlackPriorityCounts(unreadOnly = true) {
  const [counts, setCounts] = useState<SlackPriorityCounts>({
    total: 0,
    high: 0,
    medium: 0,
    low: 0,
    unassigned: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("unreadOnly", String(unreadOnly));

      const data = await fetchAdasApi<SlackPriorityCounts>(
        `/api/slack-messages/priority-counts?${params}`,
      );
      setCounts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch priority counts");
    }
  }, [unreadOnly]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  return { counts, error, refetch: fetchCounts };
}
