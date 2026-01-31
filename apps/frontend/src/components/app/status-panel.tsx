import type { AIJobStats } from "@repo/types";
import {
  Activity,
  Bot,
  Check,
  Clock,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { useRecording } from "@/hooks/use-recording";
import { useStatus } from "@/hooks/use-status";
import { LevelMeter } from "./level-meter";

interface StatusPanelProps {
  /** AI Job統計 (リアルタイム更新用) */
  jobStats?: AIJobStats | null;
}

export function StatusPanel({ jobStats }: StatusPanelProps) {
  const { error, loading, refetch } = useStatus();
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
        {/* AI Job Queue - Inline */}
        {jobStats && (
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Bot className="size-3.5" />
              <span className="text-xs font-medium">AI</span>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`flex items-center gap-1 ${jobStats.processing > 0 ? "text-blue-500" : "text-muted-foreground"}`}
                title="Processing"
              >
                <Loader2 className={`size-3.5 ${jobStats.processing > 0 ? "animate-spin" : ""}`} />
                {jobStats.processing}
              </span>
              <span
                className={`flex items-center gap-1 ${jobStats.pending > 0 ? "text-orange-500" : "text-muted-foreground"}`}
                title="Pending"
              >
                <Clock className="size-3.5" />
                {jobStats.pending}
              </span>
              <span className="flex items-center gap-1 text-muted-foreground" title="Completed">
                <Check className="size-3.5" />
                {jobStats.completed}
              </span>
              <span
                className={`flex items-center gap-1 ${jobStats.failed > 0 ? "text-red-500" : "text-muted-foreground"}`}
                title="Failed"
              >
                <X className="size-3.5" />
                {jobStats.failed}
              </span>
            </div>
          </div>
        )}

        {/* Native Recording - Inline */}
        {hasNativeRecording && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Rec</span>
              {micRecording !== null && (
                <Label
                  htmlFor="mic-toggle"
                  className="flex cursor-pointer items-center gap-1.5"
                  title="Microphone"
                >
                  {micRecording ? (
                    <Mic className="size-4 text-red-500" />
                  ) : (
                    <MicOff className="size-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="mic-toggle"
                    className="scale-75"
                    checked={micRecording}
                    disabled={togglingMic}
                    onCheckedChange={toggleMic}
                  />
                </Label>
              )}
              {speakerRecording !== null && (
                <Label
                  htmlFor="speaker-toggle"
                  className="flex cursor-pointer items-center gap-1.5"
                  title="System Audio"
                >
                  {speakerRecording ? (
                    <Volume2 className="size-4 text-red-500" />
                  ) : (
                    <VolumeX className="size-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="speaker-toggle"
                    className="scale-75"
                    checked={speakerRecording}
                    disabled={togglingSpeaker}
                    onCheckedChange={toggleSpeaker}
                  />
                </Label>
              )}
            </div>
            {/* Level meters when recording */}
            {(micRecording || speakerRecording) && (
              <div className="flex gap-2">
                {micRecording && <LevelMeter level={levels.mic} className="flex-1" />}
                {speakerRecording && <LevelMeter level={levels.speaker} className="flex-1" />}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
