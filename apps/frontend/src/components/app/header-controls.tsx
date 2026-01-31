import type { AIJobStats } from "@repo/types";
import {
  AlertTriangle,
  Bot,
  Check,
  Clock,
  HelpCircle,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBrowserRecording } from "@/hooks/use-browser-recording";
import { useConfig } from "@/hooks/use-config";
import { formatTimeJST } from "@/lib/date";
import { BrowserLevelMeter } from "./browser-level-meter";
import { ScreenShareGuide } from "./screen-share-guide";
import { ThemeToggle } from "./theme-toggle";

interface HeaderControlsProps {
  now: Date;
  date: string;
  onDateChange: (date: string) => void;
  jobStats?: AIJobStats | null;
}

export function HeaderControls({ now, date, onDateChange, jobStats }: HeaderControlsProps) {
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
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
      {/* Title */}
      <h1 className="text-xl font-bold">All Day Activity Summarizer</h1>

      <div className="h-4 w-px bg-border" />

      {/* AI Job Stats */}
      {jobStats && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <Bot className="size-4 text-muted-foreground" />
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
          <div className="h-4 w-px bg-border" />
        </>
      )}

      {/* Browser Recording */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-2 px-2">
            {isBrowserRecording && (
              <Badge variant="destructive" className="h-5 animate-pulse px-1.5 text-xs">
                REC
              </Badge>
            )}
            <Label className="flex cursor-pointer items-center gap-1" title="Microphone">
              {browserRecording.micRecording ? (
                <Mic className="size-4 text-red-500" />
              ) : (
                <MicOff className="size-4 text-muted-foreground" />
              )}
            </Label>
            <Label className="flex cursor-pointer items-center gap-1" title="System Audio">
              {browserRecording.systemRecording ? (
                <Volume2 className="size-4 text-red-500" />
              ) : (
                <VolumeX className="size-4 text-muted-foreground" />
              )}
            </Label>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Browser Recording</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowGuide(!showGuide)}
                className="h-6 w-6 p-0"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </Button>
            </div>

            {whisperDisabled && (
              <Alert variant="default" className="py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  文字起こしは無効化されています
                </AlertDescription>
              </Alert>
            )}

            {browserRecording.error && (
              <p className="text-xs text-destructive">{browserRecording.error.message}</p>
            )}

            <div className="flex items-center gap-3">
              <Label className="flex items-center gap-1.5" title="Microphone">
                {browserRecording.micRecording ? (
                  <Mic className="size-4 text-red-500" />
                ) : (
                  <MicOff className="size-4 text-muted-foreground" />
                )}
                <Button
                  size="sm"
                  variant={browserRecording.micRecording ? "destructive" : "outline"}
                  disabled={micLoading}
                  onClick={handleBrowserMicToggle}
                  className="h-6 px-2 text-xs"
                >
                  {browserRecording.micRecording ? "Stop" : "Start"}
                </Button>
              </Label>
              <Label className="flex items-center gap-1.5" title="System Audio">
                {browserRecording.systemRecording ? (
                  <Volume2 className="size-4 text-red-500" />
                ) : (
                  <VolumeX className="size-4 text-muted-foreground" />
                )}
                <Button
                  size="sm"
                  variant={browserRecording.systemRecording ? "destructive" : "outline"}
                  disabled={systemLoading}
                  onClick={handleBrowserSystemToggle}
                  className="h-6 px-2 text-xs"
                >
                  {browserRecording.systemRecording ? "Stop" : "Start"}
                </Button>
              </Label>
            </div>

            {isBrowserRecording && (
              <div className="flex gap-2">
                {browserRecording.micRecording && (
                  <BrowserLevelMeter level={browserRecording.micLevel} className="flex-1" />
                )}
                {browserRecording.systemRecording && (
                  <BrowserLevelMeter level={browserRecording.systemLevel} className="flex-1" />
                )}
              </div>
            )}

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
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex-1" />

      {/* Time, Date & Theme */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-muted-foreground">{formatTimeJST(now)}</span>
        <Input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="h-8 w-auto text-sm"
        />
        <ThemeToggle />
      </div>
    </div>
  );
}
