import { HelpCircle, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { useBrowserRecording } from "@/hooks/use-browser-recording";
import { useRecording } from "@/hooks/use-recording";
import { useStatus } from "@/hooks/use-status";
import { BrowserLevelMeter } from "./browser-level-meter";
import { LevelMeter } from "./level-meter";
import { ScreenShareGuide } from "./screen-share-guide";

export function StatusPanel() {
  const { status, error, loading } = useStatus();
  const { micRecording, speakerRecording, togglingMic, togglingSpeaker, toggleMic, toggleSpeaker } =
    useRecording();
  const { levels } = useAudioLevels({
    enabled: micRecording === true || speakerRecording === true,
  });

  // Browser Recording
  const browserRecording = useBrowserRecording();
  const [micLoading, setMicLoading] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const isBrowserRecording = browserRecording.micRecording || browserRecording.systemRecording;
  const hasNativeRecording = micRecording !== null || speakerRecording !== null;

  const handleBrowserMicToggle = async () => {
    setMicLoading(true);
    try {
      if (browserRecording.micRecording) {
        await browserRecording.stopMic();
      } else {
        await browserRecording.startMic();
      }
    } finally {
      setMicLoading(false);
    }
  };

  const handleBrowserSystemToggle = async () => {
    setSystemLoading(true);
    try {
      if (browserRecording.systemRecording) {
        await browserRecording.stopSystem();
      } else {
        await browserRecording.startSystem();
      }
    } finally {
      setSystemLoading(false);
    }
  };

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

        {/* Browser Recording */}
        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Browser Recording</span>
              {isBrowserRecording && (
                <Badge variant="destructive" className="animate-pulse text-xs">
                  REC
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowGuide(!showGuide)}
              className="h-6 w-6 p-0"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
          </div>

          {browserRecording.error && (
            <p className="text-xs text-destructive">{browserRecording.error.message}</p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                {browserRecording.micRecording ? (
                  <Mic className="h-4 w-4 text-red-500" />
                ) : (
                  <MicOff className="h-4 w-4 text-zinc-400" />
                )}
                Microphone
              </Label>
              <div className="flex items-center gap-2">
                <Badge variant={browserRecording.micRecording ? "default" : "secondary"}>
                  {browserRecording.micRecording ? "ON" : "OFF"}
                </Badge>
                <Button
                  size="sm"
                  variant={browserRecording.micRecording ? "destructive" : "default"}
                  disabled={micLoading}
                  onClick={handleBrowserMicToggle}
                  className="h-7 px-2 text-xs"
                >
                  {browserRecording.micRecording ? "Stop" : "Start"}
                </Button>
              </div>
            </div>
            {browserRecording.micRecording && (
              <BrowserLevelMeter level={browserRecording.micLevel} />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                {browserRecording.systemRecording ? (
                  <Volume2 className="h-4 w-4 text-red-500" />
                ) : (
                  <VolumeX className="h-4 w-4 text-zinc-400" />
                )}
                System Audio
              </Label>
              <div className="flex items-center gap-2">
                <Badge variant={browserRecording.systemRecording ? "default" : "secondary"}>
                  {browserRecording.systemRecording ? "ON" : "OFF"}
                </Badge>
                <Button
                  size="sm"
                  variant={browserRecording.systemRecording ? "destructive" : "default"}
                  disabled={systemLoading}
                  onClick={handleBrowserSystemToggle}
                  className="h-7 px-2 text-xs"
                >
                  {browserRecording.systemRecording ? "Stop" : "Start"}
                </Button>
              </div>
            </div>
            {browserRecording.systemRecording && (
              <BrowserLevelMeter level={browserRecording.systemLevel} />
            )}
          </div>

          {isBrowserRecording && browserRecording.lastChunkTime && (
            <div className="text-xs text-muted-foreground">
              Last chunk: {browserRecording.lastChunkTime.toLocaleTimeString()}
            </div>
          )}

          <Collapsible open={showGuide} onOpenChange={setShowGuide}>
            <CollapsibleContent>
              <ScreenShareGuide className="mt-2" />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardContent>
    </Card>
  );
}
