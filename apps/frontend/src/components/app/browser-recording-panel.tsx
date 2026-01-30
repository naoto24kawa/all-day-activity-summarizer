import { AlertTriangle, HelpCircle, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { useBrowserRecording } from "@/hooks/use-browser-recording";
import { useConfig } from "@/hooks/use-config";
import { formatTimeJST } from "@/lib/date";
import { BrowserLevelMeter } from "./browser-level-meter";
import { ScreenShareGuide } from "./screen-share-guide";

export function BrowserRecordingPanel() {
  const { integrations } = useConfig();
  const browserRecording = useBrowserRecording();
  const [micLoading, setMicLoading] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const isBrowserRecording = browserRecording.micRecording || browserRecording.systemRecording;
  const whisperDisabled = integrations && !integrations.whisper.enabled;

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            Browser Recording
            {isBrowserRecording && (
              <Badge variant="destructive" className="animate-pulse">
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
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {whisperDisabled && (
          <Alert variant="default" className="py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              文字起こしは無効化されています。録音は保存されますが、文字起こしは行われません。
            </AlertDescription>
          </Alert>
        )}
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
          {browserRecording.micRecording && <BrowserLevelMeter level={browserRecording.micLevel} />}
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
            Last chunk: {formatTimeJST(browserRecording.lastChunkTime)}
          </div>
        )}

        <Collapsible open={showGuide} onOpenChange={setShowGuide}>
          <CollapsibleContent>
            <ScreenShareGuide className="mt-2" />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
