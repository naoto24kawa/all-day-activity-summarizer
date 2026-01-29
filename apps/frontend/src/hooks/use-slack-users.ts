import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, patchAdasApi } from "./use-adas-api";

export interface SlackUserSummary {
  userId: string;
  slackName: string | null;
  displayName: string | null;
  speakerNames: string[] | null;
  messageCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export function useSlackUsers() {
  const [users, setUsers] = useState<SlackUserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<SlackUserSummary[]>("/api/slack-users");
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Slack users");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(() => fetchUsers(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchUsers]);

  const updateDisplayName = useCallback(
    async (userId: string, displayName: string | null) => {
      await patchAdasApi(`/api/slack-users/${encodeURIComponent(userId)}`, { displayName });
      await fetchUsers(true);
    },
    [fetchUsers],
  );

  const updateSpeakerNames = useCallback(
    async (userId: string, speakerNames: string[] | null) => {
      await patchAdasApi(`/api/slack-users/${encodeURIComponent(userId)}`, { speakerNames });
      await fetchUsers(true);
    },
    [fetchUsers],
  );

  const resetDisplayName = useCallback(
    async (userId: string) => {
      await deleteAdasApi(`/api/slack-users/${encodeURIComponent(userId)}`);
      await fetchUsers(true);
    },
    [fetchUsers],
  );

  return {
    users,
    error,
    loading,
    refetch: fetchUsers,
    updateDisplayName,
    updateSpeakerNames,
    resetDisplayName,
  };
}
