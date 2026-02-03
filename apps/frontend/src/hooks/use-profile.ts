/**
 * User Profile hooks
 *
 * プロフィール管理とプロフィール提案のフィードバックループ用フック
 */

import type {
  GenerateProfileSuggestionsResponse,
  ProfileSuggestion,
  UpdateProfileRequest,
  UserProfile,
} from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi, putAdasApi } from "@/lib/adas-api";

/**
 * ユーザープロフィールを管理するフック
 */
export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdasApi<UserProfile>("/api/profile");
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "プロフィールの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateProfile = useCallback(async (request: UpdateProfileRequest) => {
    try {
      setError(null);
      const data = await putAdasApi<UserProfile>("/api/profile", request);
      setProfile(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "プロフィールの更新に失敗しました";
      setError(message);
      throw err;
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // JSON配列を安全にパースするヘルパー
  const safeParseJsonArray = (value: string | null | undefined): string[] => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  // パース済みのプロフィール配列
  const responsibilities: string[] = safeParseJsonArray(profile?.responsibilities);
  const specialties: string[] = safeParseJsonArray(profile?.specialties);
  const knownTechnologies: string[] = safeParseJsonArray(profile?.knownTechnologies);
  const learningGoals: string[] = safeParseJsonArray(profile?.learningGoals);

  return {
    profile,
    responsibilities,
    specialties,
    knownTechnologies,
    learningGoals,
    loading,
    error,
    fetchProfile,
    updateProfile,
  };
}

/**
 * プロフィール提案を管理するフック
 */
export function useProfileSuggestions() {
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchSuggestions = useCallback(async (status?: "pending" | "accepted" | "rejected") => {
    try {
      setLoading(true);
      setError(null);
      const query = status ? `?status=${status}` : "";
      const data = await fetchAdasApi<ProfileSuggestion[]>(`/api/profile/suggestions${query}`);
      setSuggestions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提案の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const acceptSuggestion = useCallback(async (id: number) => {
    try {
      setError(null);
      const data = await postAdasApi<ProfileSuggestion>(
        `/api/profile/suggestions/${id}/accept`,
        {},
      );
      setSuggestions((prev) => prev.map((s) => (s.id === id ? data : s)));
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "提案の承認に失敗しました";
      setError(message);
      throw err;
    }
  }, []);

  const rejectSuggestion = useCallback(async (id: number) => {
    try {
      setError(null);
      const data = await postAdasApi<ProfileSuggestion>(
        `/api/profile/suggestions/${id}/reject`,
        {},
      );
      setSuggestions((prev) => prev.map((s) => (s.id === id ? data : s)));
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "提案の却下に失敗しました";
      setError(message);
      throw err;
    }
  }, []);

  const generateSuggestions = useCallback(async (daysBack = 7) => {
    try {
      setGenerating(true);
      setError(null);
      const data = await postAdasApi<GenerateProfileSuggestionsResponse>(
        "/api/profile/suggestions/generate",
        { daysBack },
      );
      // 新しい提案を追加
      setSuggestions((prev) => [...data.suggestions, ...prev]);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "提案の生成に失敗しました";
      setError(message);
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    fetchSuggestions("pending");
  }, [fetchSuggestions]);

  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  return {
    suggestions,
    pendingSuggestions,
    loading,
    error,
    generating,
    fetchSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    generateSuggestions,
  };
}
