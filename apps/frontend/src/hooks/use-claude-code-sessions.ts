/**
 * Claude Code Sessions Hook
 */

import type { ClaudeCodeMessage, ClaudeCodeSession } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { ADAS_API_URL, fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export interface ClaudeCodeStats {
  totalSessions: number;
  totalProjects: number;
  projects: Array<{
    projectPath: string;
    projectName: string | null;
    sessionCount: number;
    totalUserMessages: number;
    totalAssistantMessages: number;
    totalToolUses: number;
  }>;
}

export function useClaudeCodeSessions(date?: string) {
  const [sessions, setSessions] = useState<ClaudeCodeSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (date) params.set("date", date);

        const data = await fetchAdasApi<ClaudeCodeSession[]>(`/api/claude-code-sessions?${params}`);
        setSessions(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch Claude Code sessions");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(() => fetchSessions(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const syncSessions = useCallback(async () => {
    try {
      await postAdasApi("/api/claude-code-sessions/sync", {});
      await fetchSessions(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync sessions");
    }
  }, [fetchSessions]);

  const updateSession = useCallback(
    async (id: number, data: { projectId?: number | null }) => {
      await fetch(`${ADAS_API_URL}/api/claude-code-sessions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await fetchSessions(true);
    },
    [fetchSessions],
  );

  return { sessions, error, loading, refetch: fetchSessions, syncSessions, updateSession };
}

export function useClaudeCodeStats(date?: string) {
  const [stats, setStats] = useState<ClaudeCodeStats>({
    totalSessions: 0,
    totalProjects: 0,
    projects: [],
  });
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);

      const data = await fetchAdasApi<ClaudeCodeStats>(`/api/claude-code-sessions/stats?${params}`);
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    }
  }, [date]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, error, refetch: fetchStats };
}

export function useClaudeCodeMessages(sessionId: string | null) {
  const [messages, setMessages] = useState<ClaudeCodeMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      setLoading(true);
      try {
        const data = await fetchAdasApi<ClaudeCodeMessage[]>(
          `/api/claude-code-sessions/${sessionId}/messages`,
        );
        setMessages(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch messages");
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [sessionId]);

  return { messages, loading, error };
}
