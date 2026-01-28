import type { PromptTarget, SegmentFeedback } from "@repo/types";
import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, postAdasApi } from "./use-adas-api";

export function useSegmentFeedbacks(date: string) {
  const [feedbacks, setFeedbacks] = useState<SegmentFeedback[]>([]);

  const fetchFeedbacks = useCallback(async () => {
    try {
      const data = await fetchAdasApi<SegmentFeedback[]>(`/api/feedbacks?date=${date}`);
      setFeedbacks(data);
    } catch {
      // Silently ignore - feedbacks are non-critical
    }
  }, [date]);

  useEffect(() => {
    fetchFeedbacks();
  }, [fetchFeedbacks]);

  const postFeedback = useCallback(
    async (segmentId: number, rating: "good" | "bad", target?: PromptTarget, reason?: string) => {
      const result = await postAdasApi<SegmentFeedback>(`/api/segments/${segmentId}/feedback`, {
        rating,
        target,
        reason: reason || undefined,
      });
      setFeedbacks((prev) => [...prev, result]);
      return result;
    },
    [],
  );

  const getFeedback = useCallback(
    (segmentId: number): SegmentFeedback | undefined => {
      return feedbacks.find((f) => f.segmentId === segmentId);
    },
    [feedbacks],
  );

  return { feedbacks, postFeedback, getFeedback, refetch: fetchFeedbacks };
}
