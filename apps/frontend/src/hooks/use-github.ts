/**
 * GitHub Hooks
 */

import type {
  GitHubComment,
  GitHubCommentsUnreadCounts,
  GitHubItem,
  GitHubUnreadCounts,
} from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export function useGitHubItems(date?: string) {
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (date) params.set("date", date);

        const data = await fetchAdasApi<GitHubItem[]>(`/api/github-items?${params}`);
        setItems(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch GitHub items");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchItems();
    const interval = setInterval(() => fetchItems(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchItems]);

  const markAsRead = useCallback(
    async (id: number) => {
      await fetch(`${ADAS_API_URL}/api/github-items/${id}/read`, { method: "PATCH" });
      await fetchItems(true);
    },
    [fetchItems],
  );

  const markAllAsRead = useCallback(
    async (options?: {
      date?: string;
      type?: "issue" | "pull_request";
      reviewRequested?: boolean;
    }) => {
      await postAdasApi("/api/github-items/mark-all-read", options || {});
      await fetchItems(true);
    },
    [fetchItems],
  );

  return { items, error, loading, refetch: fetchItems, markAsRead, markAllAsRead };
}

export function useGitHubComments(date?: string) {
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (date) params.set("date", date);

        const data = await fetchAdasApi<GitHubComment[]>(`/api/github-comments?${params}`);
        setComments(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch GitHub comments");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchComments();
    const interval = setInterval(() => fetchComments(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  const markAsRead = useCallback(
    async (id: number) => {
      await fetch(`${ADAS_API_URL}/api/github-comments/${id}/read`, { method: "PATCH" });
      await fetchComments(true);
    },
    [fetchComments],
  );

  const markAllAsRead = useCallback(
    async (options?: { date?: string; type?: "issue_comment" | "review_comment" | "review" }) => {
      await postAdasApi("/api/github-comments/mark-all-read", options || {});
      await fetchComments(true);
    },
    [fetchComments],
  );

  return { comments, error, loading, refetch: fetchComments, markAsRead, markAllAsRead };
}

export function useGitHubUnreadCounts(date?: string) {
  const [counts, setCounts] = useState<GitHubUnreadCounts>({
    total: 0,
    issue: 0,
    pullRequest: 0,
    reviewRequest: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const data = await fetchAdasApi<GitHubUnreadCounts>(
        `/api/github-items/unread-count?${params}`,
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

export function useGitHubCommentsUnreadCounts(date?: string) {
  const [counts, setCounts] = useState<GitHubCommentsUnreadCounts>({
    total: 0,
    issueComment: 0,
    reviewComment: 0,
    review: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const data = await fetchAdasApi<GitHubCommentsUnreadCounts>(
        `/api/github-comments/unread-count?${params}`,
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
