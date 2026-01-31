import type { Vocabulary, VocabularySource } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { deleteAdasApi, fetchAdasApi, postAdasApi, putAdasApi } from "@/lib/adas-api";

export function useVocabulary() {
  const [terms, setTerms] = useState<Vocabulary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTerms = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<Vocabulary[]>("/api/vocabulary");
      setTerms(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch vocabulary");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerms();
  }, [fetchTerms]);

  const addTerm = useCallback(
    async (
      term: string,
      options?: { reading?: string; category?: string; source?: VocabularySource },
    ) => {
      const result = await postAdasApi<Vocabulary>("/api/vocabulary", {
        term,
        reading: options?.reading,
        category: options?.category,
        source: options?.source ?? "manual",
      });
      await fetchTerms(true);
      return result;
    },
    [fetchTerms],
  );

  const updateTerm = useCallback(
    async (
      id: number,
      updates: { term?: string; reading?: string | null; category?: string | null },
    ) => {
      const result = await putAdasApi<Vocabulary>(`/api/vocabulary/${id}`, updates);
      await fetchTerms(true);
      return result;
    },
    [fetchTerms],
  );

  const removeTerm = useCallback(
    async (id: number) => {
      await deleteAdasApi(`/api/vocabulary/${id}`);
      await fetchTerms(true);
    },
    [fetchTerms],
  );

  return {
    terms,
    loading,
    error,
    addTerm,
    updateTerm,
    removeTerm,
    refresh: fetchTerms,
  };
}
