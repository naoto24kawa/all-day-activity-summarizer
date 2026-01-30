import type {
  InterpretIssueType,
  PromptTarget,
  SegmentFeedback,
  SegmentFeedbackResponse,
} from "@repo/types";
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
    async (
      segmentId: number,
      rating: "good" | "bad",
      target?: PromptTarget,
      reason?: string,
      issues?: InterpretIssueType[],
      correctedText?: string,
    ): Promise<SegmentFeedbackResponse> => {
      const result = await postAdasApi<SegmentFeedbackResponse>(
        `/api/segments/${segmentId}/feedback`,
        {
          rating,
          target,
          reason: reason || undefined,
          issues: issues || undefined,
          correctedText: correctedText || undefined,
        },
      );
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
