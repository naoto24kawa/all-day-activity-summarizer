import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStatus } from "@/hooks/use-status";

export function StatusPanel() {
  const { status, error, loading } = useStatus();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="destructive">Offline</Badge>
          <p className="mt-2 text-sm text-muted-foreground">
            CLI server is not running. Start with: bun run cli -- serve
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Status
          <Badge variant="default">Online</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{status?.date}</dd>
          <dt className="text-muted-foreground">Transcriptions</dt>
          <dd>{status?.transcriptionSegments}</dd>
          <dt className="text-muted-foreground">Summaries</dt>
          <dd>{status?.summaries}</dd>
          <dt className="text-muted-foreground">Latest</dt>
          <dd>
            {status?.latestTranscriptionTime
              ? new Date(status.latestTranscriptionTime).toLocaleTimeString()
              : "N/A"}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
