/**
 * Slack Channels Hook
 *
 * チャンネル単位でのプロジェクト紐づけを管理
 */

import type { SlackChannel } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { ADAS_API_URL, fetchAdasApi } from "@/lib/adas-api";

export function useSlackChannels() {
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchChannels = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<SlackChannel[]>("/api/slack-channels");
      setChannels(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Slack channels");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const updateChannelProject = useCallback(
    async (channelId: string, projectId: number | null) => {
      await fetch(`${ADAS_API_URL}/api/slack-channels/${channelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      await fetchChannels(true);
    },
    [fetchChannels],
  );

  const getChannelProjectId = useCallback(
    (channelId: string): number | null => {
      const channel = channels.find((c) => c.channelId === channelId);
      return channel?.projectId ?? null;
    },
    [channels],
  );

  return {
    channels,
    error,
    loading,
    refetch: fetchChannels,
    updateChannelProject,
    getChannelProjectId,
  };
}
