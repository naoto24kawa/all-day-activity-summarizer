import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranscriptions } from "@/hooks/use-transcriptions";
import { formatTimeJST } from "@/lib/date";
import { cn } from "@/lib/utils";

type SpeakerFilter = "all" | "me" | "others";

interface TranscriptionListProps {
  date: string;
}

export function TranscriptionList({ date }: TranscriptionListProps) {
  const { segments, error, loading } = useTranscriptions(date);
  const [speakerFilter, setSpeakerFilter] = useState<SpeakerFilter>("all");

  const filteredSegments = useMemo(() => {
    if (speakerFilter === "all") return segments;
    if (speakerFilter === "me") return segments.filter((s) => s.speaker === "Me");
    return segments.filter((s) => s.speaker !== "Me");
  }, [segments, speakerFilter]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcriptions</CardTitle>
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
          <CardTitle>Transcriptions</CardTitle>
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
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            Transcriptions
            <Badge variant="secondary" className="ml-2">
              {filteredSegments.length}
              {speakerFilter !== "all" && `/${segments.length}`}
            </Badge>
          </CardTitle>
          <div className="flex gap-1">
            {(["all", "me", "others"] as const).map((filter) => (
              <Button
                key={filter}
                variant={speakerFilter === filter ? "default" : "outline"}
                size="sm"
                onClick={() => setSpeakerFilter(filter)}
                className={cn(
                  "h-7 px-2 text-xs",
                  speakerFilter === filter && "pointer-events-none",
                )}
              >
                {filter === "all" ? "All" : filter === "me" ? "Me" : "Others"}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {filteredSegments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {segments.length === 0
                ? "No transcriptions for this date."
                : `No transcriptions matching filter "${speakerFilter}".`}
            </p>
          ) : (
            <div className="space-y-3">
              {[...filteredSegments].reverse().map((segment) => (
                <div key={segment.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {formatTimeJST(segment.startTime)} - {formatTimeJST(segment.endTime)}
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
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
