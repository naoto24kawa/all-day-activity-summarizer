import type { FeedbackRating, Summary, SummaryIssueType } from "@repo/types";
import {
  Calendar,
  Clock,
  FileText,
  Minus,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SummaryFeedbackDialog } from "@/components/app/summary-feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeedbacks } from "@/hooks/use-feedbacks";
import { useJobProgress } from "@/hooks/use-job-progress";
import { useSummaries } from "@/hooks/use-summaries";
import { formatTimeJST } from "@/lib/date";

interface SummaryViewProps {
  date: string;
  className?: string;
}

export function SummaryView({ date, className }: SummaryViewProps) {
  const {
    summaries: timesSummaries,
    loading: timesLoading,
    error: timesError,
    refetch: refetchTimes,
  } = useSummaries(date, "times");
  const {
    summaries: dailySummaries,
    loading: dailyLoading,
    error: dailyError,
    refetch: refetchDaily,
  } = useSummaries(date, "daily");
  const { generateSummary } = useSummaries(date);
  const { getFeedback, postFeedback } = useFeedbacks("summary", date);
  const {
    trackJob,
    trackJobs,
    isProcessing: generating,
  } = useJobProgress({
    onAllCompleted: () => {
      // 全ジョブ完了時にサマリを再取得
      refetchTimes();
      refetchDaily();
    },
  });
  const [pendingFeedback, setPendingFeedback] = useState<{
    summaryId: number;
    rating: FeedbackRating;
  } | null>(null);

  const handleRefresh = async () => {
    await Promise.all([refetchTimes(), refetchDaily()]);
  };

  const handleGenerate = async () => {
    const result = await generateSummary({ date });
    // jobId または jobIds を追跡
    if (result.jobIds) {
      trackJobs(result.jobIds);
    } else if (result.jobId) {
      trackJob(result.jobId);
    }
  };

  const handleFeedbackClick = (summaryId: number, rating: FeedbackRating) => {
    setPendingFeedback({ summaryId, rating });
  };

  const handleFeedbackSubmit = async (data: {
    issues?: SummaryIssueType[];
    reason?: string;
    correctedText?: string;
  }) => {
    if (pendingFeedback) {
      await postFeedback({
        targetId: pendingFeedback.summaryId,
        rating: pendingFeedback.rating,
        issues: data.issues,
        reason: data.reason,
        correctedText: data.correctedText,
      });
      setPendingFeedback(null);
    }
  };

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-500" />
            Summaries
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
              <Sparkles className={`mr-1 h-3 w-3 ${generating ? "animate-pulse" : ""}`} />
              {generating ? "Generating..." : "Generate"}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Tabs defaultValue="daily" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mb-2 shrink-0">
            <TabsTrigger value="daily" className="gap-1">
              <Calendar className="h-3 w-3" />
              Daily
              {dailySummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {dailySummaries.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="times" className="gap-1">
              <Clock className="h-3 w-3" />
              Times
              {timesSummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {timesSummaries.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily" className="min-h-0 flex-1 overflow-auto">
            {dailyLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : dailyError ? (
              <p className="text-sm text-muted-foreground">{dailyError}</p>
            ) : dailySummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No daily summary yet.</p>
            ) : (
              <div className="space-y-4">
                {dailySummaries.map((summary) => (
                  <SummaryItem
                    key={summary.id}
                    summary={summary}
                    feedback={getFeedback(summary.id)?.rating ?? null}
                    onFeedback={(rating) => handleFeedbackClick(summary.id, rating)}
                    showTimeRange={false}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="times" className="min-h-0 flex-1 overflow-auto">
            {timesLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : timesError ? (
              <p className="text-sm text-muted-foreground">{timesError}</p>
            ) : timesSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No times summaries yet. Use Integrations panel to generate.
              </p>
            ) : (
              <div className="space-y-4">
                {[...timesSummaries].reverse().map((summary) => (
                  <SummaryItem
                    key={summary.id}
                    summary={summary}
                    feedback={getFeedback(summary.id)?.rating ?? null}
                    onFeedback={(rating) => handleFeedbackClick(summary.id, rating)}
                    showTimeRange
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
      {pendingFeedback && (
        <SummaryFeedbackDialog
          open={!!pendingFeedback}
          rating={pendingFeedback.rating}
          onSubmit={handleFeedbackSubmit}
          onCancel={() => setPendingFeedback(null)}
        />
      )}
    </Card>
  );
}

function SummaryItem({
  summary,
  feedback,
  onFeedback,
  showTimeRange,
}: {
  summary: Summary;
  feedback: FeedbackRating | null;
  onFeedback: (rating: FeedbackRating) => void;
  showTimeRange: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 flex items-center justify-between">
        {showTimeRange ? (
          <p className="text-xs font-medium text-muted-foreground">
            {formatTimeJST(summary.periodStart)} - {formatTimeJST(summary.periodEnd)}
          </p>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 gap-1">
          <Button
            variant={feedback === "good" ? "default" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => onFeedback("good")}
            disabled={!!feedback}
            title="Good"
          >
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button
            variant={feedback === "neutral" ? "secondary" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => onFeedback("neutral")}
            disabled={!!feedback}
            title="普通"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant={feedback === "bad" ? "destructive" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => onFeedback("bad")}
            disabled={!!feedback}
            title="Bad"
          >
            <ThumbsDown className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
        <Markdown remarkPlugins={[remarkGfm]}>{summary.content}</Markdown>
      </div>
    </div>
  );
}
