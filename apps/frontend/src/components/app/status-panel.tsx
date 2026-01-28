import { Mic, MicOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useRecording } from "@/hooks/use-recording";
import { useStatus } from "@/hooks/use-status";

export function StatusPanel() {
  const { status, error, loading } = useStatus();
  const { recording, toggling, toggle } = useRecording();

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
      <CardContent className="space-y-4">
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

        {recording !== null && (
          <div className="flex items-center justify-between border-t pt-3">
            <Label
              htmlFor="recording-toggle"
              className="flex items-center gap-1.5 text-sm font-medium"
            >
              {recording ? (
                <Mic className="h-4 w-4 text-red-500" />
              ) : (
                <MicOff className="h-4 w-4 text-zinc-400" />
              )}
              Recording
            </Label>
            <div className="flex items-center gap-2">
              <Badge variant={recording ? "default" : "secondary"}>
                {recording ? "ON" : "OFF"}
              </Badge>
              <Switch
                id="recording-toggle"
                checked={recording}
                disabled={toggling}
                onCheckedChange={toggle}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
