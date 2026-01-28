import type { TranscriptionSegment } from "@repo/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranscriptions } from "@/hooks/use-transcriptions";

interface ActivityFeedProps {
  date: string;
}

export function ActivityFeed({ date }: ActivityFeedProps) {
  const { segments, loading, error } = useTranscriptions(date);

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

  return (
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
        <div className="h-[400px] overflow-y-auto rounded-[inherit]">
          {segments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity for this date.</p>
          ) : (
            <div className="space-y-3">
              {[...segments].reverse().map((segment) => (
                <TranscriptionItem key={segment.id} segment={segment} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TranscriptionItem({ segment }: { segment: TranscriptionSegment }) {
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
        <p className="text-sm">{segment.transcription}</p>
      </div>
    </div>
  );
}
