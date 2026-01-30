/**
 * Prompt Improvements Hook
 */

import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export interface PromptImprovement {
  id: number;
  target: string;
  previousPrompt: string;
  newPrompt: string;
  feedbackCount: number;
  goodCount: number;
  badCount: number;
  improvementReason: string | null;
  status: "pending" | "approved" | "rejected";
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

export interface PromptImprovementStats {
  [target: string]: {
    goodCount: number;
    badCount: number;
    pendingImprovements: number;
    canGenerate: boolean;
  };
}

export function usePromptImprovements(status?: "pending" | "approved" | "rejected") {
  const [improvements, setImprovements] = useState<PromptImprovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchImprovements = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (status) {
          params.set("status", status);
        }
        const url = `/api/prompt-improvements${params.toString() ? `?${params}` : ""}`;
        const data = await fetchAdasApi<PromptImprovement[]>(url);
        setImprovements(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch improvements");
      } finally {
        setLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    fetchImprovements();
  }, [fetchImprovements]);

  return { improvements, error, loading, refetch: fetchImprovements };
}

export function usePromptImprovementStats() {
  const [stats, setStats] = useState<PromptImprovementStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<PromptImprovementStats>("/api/prompt-improvements/stats");
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, error, loading, refetch: fetchStats };
}

export function useGenerateImprovement() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (target: string): Promise<PromptImprovement | null> => {
    try {
      setGenerating(true);
      setError(null);
      const result = await postAdasApi<PromptImprovement>("/api/prompt-improvements/generate", {
        target,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate improvement";
      setError(message);
      return null;
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generate, generating, error };
}

export function useApproveImprovement() {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(async (id: number): Promise<PromptImprovement | null> => {
    try {
      setApproving(true);
      setError(null);
      const result = await postAdasApi<PromptImprovement>(
        `/api/prompt-improvements/${id}/approve`,
        {},
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to approve improvement";
      setError(message);
      return null;
    } finally {
      setApproving(false);
    }
  }, []);

  return { approve, approving, error };
}

export function useRejectImprovement() {
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reject = useCallback(async (id: number): Promise<PromptImprovement | null> => {
    try {
      setRejecting(true);
      setError(null);
      const result = await postAdasApi<PromptImprovement>(
        `/api/prompt-improvements/${id}/reject`,
        {},
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reject improvement";
      setError(message);
      return null;
    } finally {
      setRejecting(false);
    }
  }, []);

  return { reject, rejecting, error };
}
