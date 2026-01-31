import type { AIJobStats } from "@repo/types";
import { Activity, Bot, Mic, MicOff, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { useRecording } from "@/hooks/use-recording";
import { useStatus } from "@/hooks/use-status";
import { formatTimeJST } from "@/lib/date";
import { LevelMeter } from "./level-meter";

interface StatusPanelProps {
  /** AI Job統計 (リアルタイム更新用) */
  jobStats?: AIJobStats | null;
}

export function StatusPanel({ jobStats }: StatusPanelProps) {
  const { status, error, loading, refetch } = useStatus();
  const { micRecording, speakerRecording, togglingMic, togglingSpeaker, toggleMic, toggleSpeaker } =
    useRecording();
  const { levels } = useAudioLevels({
    enabled: micRecording === true || speakerRecording === true,
  });

  const hasNativeRecording = micRecording !== null || speakerRecording !== null;

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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-green-500" />
          Status
          <Badge variant="default">Online</Badge>
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={refetch} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
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
              ? formatTimeJST(status.latestTranscriptionTime)
              : "N/A"}
          </dd>
        </dl>

        {/* AI Job Queue */}
        {jobStats && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Bot className="size-3" />
              AI Job Queue
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Processing</dt>
              <dd>
                {jobStats.processing > 0 ? (
                  <Badge variant="secondary" className="text-xs">
                    {jobStats.processing}
                  </Badge>
                ) : (
                  "0"
                )}
              </dd>
              <dt className="text-muted-foreground">Pending</dt>
              <dd>
                {jobStats.pending > 0 ? (
                  <Badge variant="outline" className="text-xs">
                    {jobStats.pending}
                  </Badge>
                ) : (
                  "0"
                )}
              </dd>
              <dt className="text-muted-foreground">Completed</dt>
              <dd>{jobStats.completed}</dd>
              <dt className="text-muted-foreground">Failed</dt>
              <dd>
                {jobStats.failed > 0 ? (
                  <Badge variant="destructive" className="text-xs">
                    {jobStats.failed}
                  </Badge>
                ) : (
                  "0"
                )}
              </dd>
            </dl>
          </div>
        )}

        {hasNativeRecording && (
          <div className="space-y-3 border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground">Native Recording</div>
            {micRecording !== null && (
              <div className="space-y-1.5">
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
                {micRecording && <LevelMeter level={levels.mic} />}
              </div>
            )}

            {speakerRecording !== null && (
              <div className="space-y-1.5">
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
                {speakerRecording && <LevelMeter level={levels.speaker} />}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
