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
  Timer,
} from "lucide-react";
import { useState } from "react";
import { SummaryFeedbackDialog } from "@/components/app/summary-feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeedbacks } from "@/hooks/use-feedbacks";
import { useSummaries } from "@/hooks/use-summaries";
import { formatTimeJST } from "@/lib/date";

interface SummaryViewProps {
  date: string;
  className?: string;
}

export function SummaryView({ date, className }: SummaryViewProps) {
  const {
    summaries: pomodoroSummaries,
    loading: pomodoroLoading,
    error: pomodoroError,
    refetch: refetchPomodoro,
  } = useSummaries(date, "pomodoro");
  const {
    summaries: hourlySummaries,
    loading: hourlyLoading,
    error: hourlyError,
    refetch: refetchHourly,
  } = useSummaries(date, "hourly");
  const {
    summaries: dailySummaries,
    loading: dailyLoading,
    error: dailyError,
    refetch: refetchDaily,
  } = useSummaries(date, "daily");
  const { generateSummary } = useSummaries(date);
  const { getFeedback, postFeedback } = useFeedbacks("summary", date);
  const [generating, setGenerating] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState<{
    summaryId: number;
    rating: FeedbackRating;
  } | null>(null);

  const handleRefresh = async () => {
    await Promise.all([refetchPomodoro(), refetchHourly(), refetchDaily()]);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateSummary({ date });
    } finally {
      setGenerating(false);
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
        <Tabs defaultValue="pomodoro" className="flex min-h-0 flex-1 flex-col">
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
            <TabsTrigger value="hourly" className="gap-1">
              <Clock className="h-3 w-3" />
              Hourly
              {hourlySummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {hourlySummaries.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pomodoro" className="gap-1">
              <Timer className="h-3 w-3" />
              Pomodoro
              {pomodoroSummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {pomodoroSummaries.length}
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

          <TabsContent value="hourly" className="min-h-0 flex-1 overflow-auto">
            {hourlyLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : hourlyError ? (
              <p className="text-sm text-muted-foreground">{hourlyError}</p>
            ) : hourlySummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hourly summaries yet.</p>
            ) : (
              <div className="space-y-4">
                {[...hourlySummaries].reverse().map((summary) => (
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

          <TabsContent value="pomodoro" className="min-h-0 flex-1 overflow-auto">
            {pomodoroLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : pomodoroError ? (
              <p className="text-sm text-muted-foreground">{pomodoroError}</p>
            ) : pomodoroSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pomodoro summaries yet.</p>
            ) : (
              <div className="space-y-4">
                {[...pomodoroSummaries].reverse().map((summary) => (
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
      <pre className="whitespace-pre-wrap text-sm">{summary.content}</pre>
    </div>
  );
}
