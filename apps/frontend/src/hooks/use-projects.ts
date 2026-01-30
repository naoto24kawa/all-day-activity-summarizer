/**
 * Projects Hook
 *
 * プロジェクト管理用のカスタムフック
 */

import type {
  AutoDetectProjectsResponse,
  CreateProjectRequest,
  Project,
  ProjectStats,
  UpdateProjectRequest,
} from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, patchAdasApi, postAdasApi } from "@/lib/adas-api";

export interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
}

export function useProjects(activeOnly = true) {
  const [state, setState] = useState<ProjectsState>({
    projects: [],
    loading: true,
    error: null,
  });
  const [autoDetecting, setAutoDetecting] = useState(false);

  const fetchProjects = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const query = activeOnly ? "?active=true" : "";
      const response = await fetchAdasApi<Project[]>(`/api/projects${query}`);
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
  }, [activeOnly]);

  const createProject = useCallback(
    async (data: CreateProjectRequest): Promise<Project | null> => {
      try {
        const response = await postAdasApi<Project>("/api/projects", data);
        await fetchProjects();
        return response;
      } catch (err) {
        console.error("Failed to create project:", err);
        return null;
      }
    },
    [fetchProjects],
  );

  const updateProject = useCallback(
    async (id: number, data: UpdateProjectRequest): Promise<Project | null> => {
      try {
        const response = await patchAdasApi<Project>(`/api/projects/${id}`, data);
        await fetchProjects();
        return response;
      } catch (err) {
        console.error("Failed to update project:", err);
        return null;
      }
    },
    [fetchProjects],
  );

  const deleteProject = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        await deleteAdasApi<{ deleted: boolean }>(`/api/projects/${id}`);
        await fetchProjects();
        return true;
      } catch (err) {
        console.error("Failed to delete project:", err);
        return false;
      }
    },
    [fetchProjects],
  );

  const fetchProjectStats = useCallback(async (id: number): Promise<ProjectStats | null> => {
    try {
      return await fetchAdasApi<ProjectStats>(`/api/projects/${id}/stats`);
    } catch (err) {
      console.error("Failed to fetch project stats:", err);
      return null;
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
    createProject,
    updateProject,
    deleteProject,
    fetchProjectStats,
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
