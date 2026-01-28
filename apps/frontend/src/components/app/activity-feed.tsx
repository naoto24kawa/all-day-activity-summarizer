import type { TranscriptionSegment } from "@repo/types";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { FeedbackDialog } from "@/components/app/feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSegmentFeedbacks } from "@/hooks/use-segment-feedback";
import { useTranscriptions } from "@/hooks/use-transcriptions";

interface ActivityFeedProps {
  date: string;
}

export function ActivityFeed({ date }: ActivityFeedProps) {
  const { segments, loading, error } = useTranscriptions(date);
  const { getFeedback, postFeedback } = useSegmentFeedbacks(date);
  const [pendingFeedback, setPendingFeedback] = useState<{
    segmentId: number;
    rating: "good" | "bad";
  } | null>(null);

  const handleFeedbackClick = (segmentId: number, rating: "good" | "bad") => {
    setPendingFeedback({ segmentId, rating });
  };

  const handleFeedbackSubmit = (reason: string) => {
    if (pendingFeedback) {
      postFeedback(pendingFeedback.segmentId, pendingFeedback.rating, "interpret", reason);
      setPendingFeedback(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Feed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const sortedSegments = [...segments].reverse();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            Activity Feed
            <Badge variant="secondary" className="ml-2">
              {segments.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {segments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity for this date.</p>
          ) : (
            <Tabs defaultValue="ai">
              <TabsList>
                <TabsTrigger value="ai">AI</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
              <TabsContent value="ai">
                <SegmentList
                  segments={sortedSegments}
                  mode="ai"
                  getFeedback={getFeedback}
                  onFeedbackClick={handleFeedbackClick}
                />
              </TabsContent>
              <TabsContent value="raw">
                <SegmentList
                  segments={sortedSegments}
                  mode="raw"
                  getFeedback={getFeedback}
                  onFeedbackClick={handleFeedbackClick}
                />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
      {pendingFeedback && (
        <FeedbackDialog
          open={!!pendingFeedback}
          rating={pendingFeedback.rating}
          onSubmit={handleFeedbackSubmit}
          onCancel={() => setPendingFeedback(null)}
        />
      )}
    </>
  );
}

function SegmentList({
  segments,
  mode,
  getFeedback,
  onFeedbackClick,
}: {
  segments: TranscriptionSegment[];
  mode: "ai" | "raw";
  getFeedback: (segmentId: number) => { rating: "good" | "bad" } | undefined;
  onFeedbackClick: (segmentId: number, rating: "good" | "bad") => void;
}) {
  return (
    <div className="h-[400px] overflow-y-auto">
      <div className="space-y-3">
        {segments.map((segment) => (
          <TranscriptionItem
            key={segment.id}
            segment={segment}
            mode={mode}
            feedback={getFeedback(segment.id)?.rating}
            onFeedback={(rating) => onFeedbackClick(segment.id, rating)}
          />
        ))}
      </div>
    </div>
  );
}

function TranscriptionItem({
  segment,
  mode,
  feedback,
  onFeedback,
}: {
  segment: TranscriptionSegment;
  mode: "ai" | "raw";
  feedback?: "good" | "bad";
  onFeedback: (rating: "good" | "bad") => void;
}) {
  const displayText =
    mode === "ai" && segment.interpretedText ? segment.interpretedText : segment.transcription;

  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {new Date(segment.startTime).toLocaleTimeString()} -{" "}
          {new Date(segment.endTime).toLocaleTimeString()}
        </span>
        <Badge variant="outline" className="text-xs">
          {segment.language}
        </Badge>
      </div>
      <div className="flex items-start gap-2">
        {segment.speaker && (
          <Badge variant="default" className="mt-0.5 shrink-0 text-xs">
            {segment.speaker}
          </Badge>
        )}
        <p className="flex-1 text-sm">{displayText}</p>
        <div className="flex shrink-0 gap-1">
          <Button
            variant={feedback === "good" ? "default" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => onFeedback("good")}
            disabled={!!feedback}
          >
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button
            variant={feedback === "bad" ? "destructive" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => onFeedback("bad")}
            disabled={!!feedback}
          >
            <ThumbsDown className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
