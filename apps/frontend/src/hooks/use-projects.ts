/**
 * Projects Hook
 *
 * プロジェクト管理用のカスタムフック
 */

import type { AutoDetectProjectsResponse, Project } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
}

export function useProjects() {
  const [state, setState] = useState<ProjectsState>({
    projects: [],
    loading: true,
    error: null,
  });
  const [autoDetecting, setAutoDetecting] = useState(false);

  const fetchProjects = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetchAdasApi<Project[]>("/api/projects?active=true");
      setState({
        projects: response,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState({
        projects: [],
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch projects",
      });
    }
  }, []);

  const autoDetect = useCallback(async (): Promise<AutoDetectProjectsResponse | null> => {
    setAutoDetecting(true);
    try {
      const response = await postAdasApi<AutoDetectProjectsResponse>(
        "/api/projects/auto-detect",
        {},
      );
      // Refresh projects list
      await fetchProjects();
      return response;
    } catch (err) {
      console.error("Failed to auto-detect projects:", err);
      return null;
    } finally {
      setAutoDetecting(false);
    }
  }, [fetchProjects]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return {
    projects: state.projects,
    loading: state.loading,
    error: state.error,
    autoDetecting,
    refetch: fetchProjects,
    autoDetect,
  };
}

/**
 * プロジェクト名を取得するユーティリティ
 */
export function getProjectName(projects: Project[], projectId: number | null): string | null {
  if (projectId === null) return null;
  const project = projects.find((p) => p.id === projectId);
  return project?.name ?? null;
}
