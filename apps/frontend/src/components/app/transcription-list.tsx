import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranscriptions } from "@/hooks/use-transcriptions";

interface TranscriptionListProps {
  date: string;
}

export function TranscriptionList({ date }: TranscriptionListProps) {
  const { segments, error, loading } = useTranscriptions(date);

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
        <CardTitle>
          Transcriptions
          <Badge variant="secondary" className="ml-2">
            {segments.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {segments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transcriptions for this date.</p>
          ) : (
            <div className="space-y-3">
              {segments.map((segment) => (
                <div key={segment.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {new Date(segment.startTime).toLocaleTimeString()} -{" "}
                      {new Date(segment.endTime).toLocaleTimeString()}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {segment.language}
                    </Badge>
                  </div>
                  <p className="text-sm">{segment.transcription}</p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
