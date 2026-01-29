import { useEffect, useState } from "react";
import { Mic, MicOff, Volume2, VolumeX, HelpCircle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { useBrowserRecording } from "@/hooks/use-browser-recording";
import { BrowserLevelMeter } from "./browser-level-meter";
import { ScreenShareGuide } from "./screen-share-guide";

/**
 * ブラウザでの音声録音を制御するパネル。
 * マイク録音とシステム音声録音(画面共有経由)をサポート。
 */
export function BrowserRecordingPanel() {
  const {
    micRecording,
    systemRecording,
    micLevel,
    systemLevel,
    lastChunkTime,
    startedAt,
    error,
    startMic,
    stopMic,
    startSystem,
    stopSystem,
  } = useBrowserRecording();

  const [showGuide, setShowGuide] = useState(false);
  const [micLoading, setMicLoading] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [duration, setDuration] = useState("00:00:00");

  const isRecording = micRecording || systemRecording;

  // Duration を毎秒更新
  useEffect(() => {
    if (!isRecording || !startedAt) {
      setDuration("00:00:00");
      return;
    }

    const updateDuration = () => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      setDuration(
        `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
      );
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [isRecording, startedAt]);

  const handleMicToggle = async () => {
    setMicLoading(true);
    try {
      if (micRecording) {
        await stopMic();
      } else {
        await startMic();
      }
    } finally {
      setMicLoading(false);
    }
  };

  const handleSystemToggle = async () => {
    console.log("handleSystemToggle: start", { systemRecording, systemLoading });
    setSystemLoading(true);
    try {
      if (systemRecording) {
        console.log("handleSystemToggle: calling stopSystem");
        await stopSystem();
        console.log("handleSystemToggle: stopSystem done");
      } else {
        console.log("handleSystemToggle: calling startSystem");
        await startSystem();
        console.log("handleSystemToggle: startSystem done");
      }
    } catch (e) {
      console.error("handleSystemToggle: error", e);
    } finally {
      console.log("handleSystemToggle: finally");
      setSystemLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            Browser Recording
            {isRecording && (
              <Badge variant="destructive" className="animate-pulse">
                REC
              </Badge>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowGuide(!showGuide)}
            className="h-8 w-8 p-0"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* エラー表示 */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {/* マイク */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
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
              <Button
                size="sm"
                variant={micRecording ? "destructive" : "default"}
                disabled={micLoading}
                onClick={handleMicToggle}
              >
                {micRecording ? "Stop" : "Start"}
              </Button>
            </div>
          </div>
          {micRecording && <BrowserLevelMeter level={micLevel} />}
        </div>

        {/* システム音声 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              {systemRecording ? (
                <Volume2 className="h-4 w-4 text-red-500" />
              ) : (
                <VolumeX className="h-4 w-4 text-zinc-400" />
              )}
              System Audio
            </Label>
            <div className="flex items-center gap-2">
              <Badge variant={systemRecording ? "default" : "secondary"}>
                {systemRecording ? "ON" : "OFF"}
              </Badge>
              <Button
                size="sm"
                variant={systemRecording ? "destructive" : "default"}
                disabled={systemLoading}
                onClick={handleSystemToggle}
              >
                {systemRecording ? "Stop" : "Start"}
              </Button>
            </div>
          </div>
          {systemRecording && <BrowserLevelMeter level={systemLevel} />}
        </div>

        {/* 録音ステータス */}
        {isRecording && (
          <div className="space-y-1 border-t pt-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-mono">{duration}</dd>
              <dt className="text-muted-foreground">Last chunk</dt>
              <dd>{lastChunkTime ? lastChunkTime.toLocaleTimeString() : "Waiting..."}</dd>
            </dl>
          </div>
        )}

        {/* ガイダンス */}
        <Collapsible open={showGuide} onOpenChange={setShowGuide}>
          <CollapsibleContent>
            <ScreenShareGuide className="mt-2" />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
