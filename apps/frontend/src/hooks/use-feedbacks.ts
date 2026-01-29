import type { EvaluatorJudgment, Feedback, FeedbackRating, FeedbackTargetType } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";

export function useFeedbacks(targetType: FeedbackTargetType, date: string) {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeedbacks = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const data = await fetchAdasApi<Feedback[]>(
          `/api/feedbacks/v2?targetType=${targetType}&date=${date}`,
        );
        setFeedbacks(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch feedbacks");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [targetType, date],
  );

  useEffect(() => {
    fetchFeedbacks();
  }, [fetchFeedbacks]);

  const postFeedback = useCallback(
    async (params: {
      targetId: number;
      rating: FeedbackRating;
      issues?: string[];
      reason?: string;
      correctedText?: string;
      correctJudgment?: EvaluatorJudgment;
    }) => {
      const result = await postAdasApi<Feedback>("/api/feedbacks/v2", {
        targetType,
        ...params,
      });
      setFeedbacks((prev) => [...prev, result]);
      return result;
    },
    [targetType],
  );

  const getFeedback = useCallback(
    (targetId: number): Feedback | undefined => {
      return feedbacks.find((f) => f.targetId === targetId);
    },
    [feedbacks],
  );

  return { feedbacks, loading, error, postFeedback, getFeedback, refetch: fetchFeedbacks };
}
