/**
 * GitHub Hooks
 */

import type {
  GitHubComment,
  GitHubCommentsUnreadCounts,
  GitHubItem,
  GitHubUnreadCounts,
  Project,
} from "@repo/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export function useGitHubItems() {
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<GitHubItem[]>("/api/github-items");
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch GitHub items");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
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

export function useGitHubComments() {
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<GitHubComment[]>("/api/github-comments");
      setComments(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch GitHub comments");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchComments();
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

  return {
    comments,
    error,
    loading,
    refetch: fetchComments,
    markAsRead,
    markAllAsRead,
  };
}

/** リポジトリ別サマリー */
export interface GitHubRepoSummary {
  repoOwner: string;
  repoName: string;
  issueCount: number;
  pullRequestCount: number;
  reviewRequestCount: number;
  unreadCount: number;
  projectId: number | null;
}

export interface GitHubCommentRepoSummary {
  repoOwner: string;
  repoName: string;
  commentCount: number;
  unreadCount: number;
}

export function useGitHubSummary() {
  const [repositories, setRepositories] = useState<GitHubRepoSummary[]>([]);
  const [commentRepositories, setCommentRepositories] = useState<GitHubCommentRepoSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [itemsData, commentsData] = await Promise.all([
        fetchAdasApi<{ repositories: GitHubRepoSummary[] }>("/api/github-items/summary"),
        fetchAdasApi<{ repositories: GitHubCommentRepoSummary[] }>("/api/github-comments/summary"),
      ]);
      setRepositories(itemsData.repositories);
      setCommentRepositories(commentsData.repositories);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch GitHub summary");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { repositories, commentRepositories, error, loading, refetch: fetchSummary };
}

/** 特定リポジトリのアイテム+コメントを取得 (展開時) */
export function useGitHubRepoData(owner: string | null, repo: string | null) {
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, { items: GitHubItem[]; comments: GitHubComment[] }>>(
    new Map(),
  );

  const fetchRepoData = useCallback(async (o: string, r: string) => {
    const key = `${o}/${r}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setItems(cached.items);
      setComments(cached.comments);
      return;
    }

    setLoading(true);
    try {
      const [itemsData, commentsData] = await Promise.all([
        fetchAdasApi<GitHubItem[]>(
          `/api/github-items?repoOwner=${encodeURIComponent(o)}&repoName=${encodeURIComponent(r)}`,
        ),
        fetchAdasApi<GitHubComment[]>(
          `/api/github-comments?repoOwner=${encodeURIComponent(o)}&repoName=${encodeURIComponent(r)}`,
        ),
      ]);
      cacheRef.current.set(key, { items: itemsData, comments: commentsData });
      setItems(itemsData);
      setComments(commentsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch repo data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (owner && repo) {
      fetchRepoData(owner, repo);
    } else {
      setItems([]);
      setComments([]);
    }
  }, [owner, repo, fetchRepoData]);

  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return { items, comments, loading, error, clearCache };
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
  }, [fetchCounts]);

  return { counts, error, refetch: fetchCounts };
}

/**
 * Fetch projects that have GitHub items
 */
export function useGitHubItemProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAdasApi<Project[]>("/api/github-items/projects");
      setProjects(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return { projects, loading, error, refetch: fetchProjects };
}

/**
 * Sync projectId for existing GitHub items
 */
export async function syncGitHubItemProjects(): Promise<{ updated: number }> {
  return await postAdasApi<{ updated: number }>("/api/github-items/sync-projects", {});
}
