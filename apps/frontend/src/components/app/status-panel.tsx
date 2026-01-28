import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useRecording } from "@/hooks/use-recording";
import { useStatus } from "@/hooks/use-status";

export function StatusPanel() {
  const { status, error, loading } = useStatus();
  const { micRecording, speakerRecording, togglingMic, togglingSpeaker, toggleMic, toggleSpeaker } =
    useRecording();

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

        {(micRecording !== null || speakerRecording !== null) && (
          <div className="space-y-3 border-t pt-3">
            {micRecording !== null && (
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="mic-toggle"
                  className="flex items-center gap-1.5 text-sm font-medium"
                >
                  {micRecording ? (
                    <Mic className="h-4 w-4 text-red-500" />
                  ) : (
                    <MicOff className="h-4 w-4 text-zinc-400" />
                  )}
                  Microphone
                </Label>
                <div className="flex items-center gap-2">
                  <Badge variant={micRecording ? "default" : "secondary"}>
                    {micRecording ? "ON" : "OFF"}
                  </Badge>
                  <Switch
                    id="mic-toggle"
                    checked={micRecording}
                    disabled={togglingMic}
                    onCheckedChange={toggleMic}
                  />
                </div>
              </div>
            )}

            {speakerRecording !== null && (
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="speaker-toggle"
                  className="flex items-center gap-1.5 text-sm font-medium"
                >
                  {speakerRecording ? (
                    <Volume2 className="h-4 w-4 text-red-500" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-zinc-400" />
                  )}
                  System Audio
                </Label>
                <div className="flex items-center gap-2">
                  <Badge variant={speakerRecording ? "default" : "secondary"}>
                    {speakerRecording ? "ON" : "OFF"}
                  </Badge>
                  <Switch
                    id="speaker-toggle"
                    checked={speakerRecording}
                    disabled={togglingSpeaker}
                    onCheckedChange={toggleSpeaker}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
