/**
 * Claude Code Paths Hook
 *
 * プロジェクトパス単位でのプロジェクト紐づけを管理
 */

import type { ClaudeCodePath } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, putAdasApi } from "@/lib/adas-api";

export function useClaudeCodePaths() {
  const [paths, setPaths] = useState<ClaudeCodePath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPaths = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<ClaudeCodePath[]>("/api/claude-code-paths");
      setPaths(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Claude Code paths");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPaths();
  }, [fetchPaths]);

  /**
   * プロジェクトパスのプロジェクト紐づけを更新
   */
  const updatePathProject = useCallback(
    async (projectPath: string, projectId: number | null, projectName?: string) => {
      try {
        const encodedPath = encodeURIComponent(projectPath);
        await putAdasApi<ClaudeCodePath>(`/api/claude-code-paths/${encodedPath}`, {
          projectId,
          projectName,
        });
        await fetchPaths(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update path project");
        throw err;
      }
    },
    [fetchPaths],
  );

  /**
   * プロジェクトパスに紐づけられた projectId を取得
   */
  const getPathProjectId = useCallback(
    (projectPath: string): number | null => {
      const path = paths.find((p) => p.projectPath === projectPath);
      return path?.projectId ?? null;
    },
    [paths],
  );

  return {
    paths,
    loading,
    error,
    refetch: fetchPaths,
    updatePathProject,
    getPathProjectId,
  };
}
