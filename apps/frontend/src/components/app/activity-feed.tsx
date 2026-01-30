import type { InterpretIssueType, TranscriptionSegment } from "@repo/types";
import {
  BookPlus,
  Check,
  Loader2,
  Mic,
  RefreshCw,
  Speaker,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackDialog } from "@/components/app/feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSegmentFeedbacks } from "@/hooks/use-segment-feedback";
import { useTranscriptions } from "@/hooks/use-transcriptions";
import { useVocabulary } from "@/hooks/use-vocabulary";
import { formatTimeJST } from "@/lib/date";

interface ActivityFeedProps {
  date: string;
  className?: string;
}

export function ActivityFeed({ date, className }: ActivityFeedProps) {
  const { segments, loading, error, refetch } = useTranscriptions(date);
  const { getFeedback, postFeedback } = useSegmentFeedbacks(date);
  const [pendingFeedback, setPendingFeedback] = useState<{
    segmentId: number;
    rating: "good" | "bad";
  } | null>(null);

  const handleFeedbackClick = (segmentId: number, rating: "good" | "bad") => {
    setPendingFeedback({ segmentId, rating });
  };

  const handleFeedbackSubmit = async (data: {
    reason?: string;
    issues?: InterpretIssueType[];
    correctedText?: string;
  }) => {
    if (!pendingFeedback) {
      throw new Error("No pending feedback");
    }
    const result = await postFeedback(
      pendingFeedback.segmentId,
      pendingFeedback.rating,
      "interpret",
      data.reason,
      data.issues,
      data.correctedText,
    );
    // pendingFeedback は suggestedTerms の処理後に FeedbackDialog 側でクリアされる
    // ダイアログが閉じた時 (onCancel) にクリアする
    return result;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcribe</CardTitle>
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
          <CardTitle>Transcribe</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const sortedSegments = [...segments].reverse();

  return (
    <>
      <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
        <CardHeader className="flex shrink-0 flex-row items-center justify-between">
          <CardTitle>
            Transcribe
            <Badge variant="secondary" className="ml-2">
              {segments.length}
            </Badge>
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          {segments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity for this date.</p>
          ) : (
            <Tabs defaultValue="ai" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="shrink-0">
                <TabsTrigger value="ai">AI</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
              <TabsContent value="ai" className="min-h-0 flex-1">
                <SegmentList
                  segments={sortedSegments}
                  mode="ai"
                  getFeedback={getFeedback}
                  onFeedbackClick={handleFeedbackClick}
                />
              </TabsContent>
              <TabsContent value="raw" className="min-h-0 flex-1">
                <SegmentList
                  segments={sortedSegments}
                  mode="raw"
                  getFeedback={getFeedback}
                  onFeedbackClick={handleFeedbackClick}
                />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
      {pendingFeedback && (
        <FeedbackDialog
          open={!!pendingFeedback}
          rating={pendingFeedback.rating}
          onSubmit={handleFeedbackSubmit}
          onCancel={() => setPendingFeedback(null)}
        />
      )}
    </>
  );
}

function SegmentList({
  segments,
  mode,
  getFeedback,
  onFeedbackClick,
}: {
  segments: TranscriptionSegment[];
  mode: "ai" | "raw";
  getFeedback: (segmentId: number) => { rating: "good" | "bad" } | undefined;
  onFeedbackClick: (segmentId: number, rating: "good" | "bad") => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3">
        {segments.map((segment) => (
          <TranscriptionItem
            key={segment.id}
            segment={segment}
            mode={mode}
            feedback={getFeedback(segment.id)?.rating}
            onFeedback={(rating) => onFeedbackClick(segment.id, rating)}
          />
        ))}
      </div>
    </div>
  );
}

type AddVocabState = "idle" | "adding" | "added";

function TranscriptionItem({
  segment,
  mode,
  feedback,
  onFeedback,
}: {
  segment: TranscriptionSegment;
  mode: "ai" | "raw";
  feedback?: "good" | "bad";
  onFeedback: (rating: "good" | "bad") => void;
}) {
  const displayText =
    mode === "ai" && segment.interpretedText ? segment.interpretedText : segment.transcription;

  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [addState, setAddState] = useState<AddVocabState>("idle");
  const [anchorPosition, setAnchorPosition] = useState<{ x: number; y: number } | null>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const { addTerm } = useVocabulary();

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text && text.length >= 2 && textRef.current?.contains(selection?.anchorNode ?? null)) {
      const range = selection?.getRangeAt(0);
      if (range) {
        const rect = range.getBoundingClientRect();
        const containerRect = textRef.current.getBoundingClientRect();
        setAnchorPosition({
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top,
        });
        setSelectedText(text);
        setAddState("idle");
        setPopoverOpen(true);
      }
    }
  }, []);

  const handleAddVocabulary = async () => {
    if (!selectedText) return;
    setAddState("adding");
    try {
      await addTerm(selectedText, { source: "manual" });
      setAddState("added");
      setTimeout(() => {
        setPopoverOpen(false);
        setSelectedText(null);
        setAddState("idle");
        window.getSelection()?.removeAllRanges();
      }, 1000);
    } catch {
      setAddState("idle");
    }
  };

  const handlePopoverClose = () => {
    setPopoverOpen(false);
    setSelectedText(null);
    setAddState("idle");
  };

  // クリック外でポップオーバーを閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverOpen && textRef.current && !textRef.current.contains(e.target as Node)) {
        // Popover 内のクリックは除外
        const popoverContent = document.querySelector("[data-slot='popover-content']");
        if (popoverContent?.contains(e.target as Node)) return;
        handlePopoverClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popoverOpen, handlePopoverClose]);

  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {formatTimeJST(segment.startTime)} - {formatTimeJST(segment.endTime)}
        </span>
        <Badge variant="outline" className="text-xs">
          {segment.language}
        </Badge>
        <Badge
          variant="secondary"
          className={`flex items-center gap-1 text-xs ${segment.audioSource === "mic" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"}`}
        >
          {segment.audioSource === "mic" ? (
            <>
              <Mic className="h-3 w-3" />
              Mic
            </>
          ) : (
            <>
              <Speaker className="h-3 w-3" />
              Audio
            </>
          )}
        </Badge>
      </div>
      <div className="flex items-start gap-2">
        {segment.speaker && (
          <Badge variant="default" className="mt-0.5 shrink-0 text-xs">
            {segment.speaker}
          </Badge>
        )}
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <div className="relative flex-1">
            <p ref={textRef} className="cursor-text text-sm" onMouseUp={handleTextSelection}>
              {displayText}
            </p>
            {anchorPosition && (
              <PopoverAnchor
                className="pointer-events-none absolute"
                style={{
                  left: anchorPosition.x,
                  top: anchorPosition.y,
                }}
              />
            )}
          </div>
          <PopoverContent className="w-auto p-3" side="top" align="center">
            <PopoverHeader className="mb-2">
              <PopoverTitle className="flex items-center gap-2">
                <BookPlus className="h-4 w-4" />
                単語帳に追加
              </PopoverTitle>
              <PopoverDescription className="font-mono text-xs">{selectedText}</PopoverDescription>
            </PopoverHeader>
            {addState === "added" ? (
              <div className="flex items-center justify-center gap-2 text-sm text-green-600">
                <Check className="h-4 w-4" />
                追加しました
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePopoverClose}
                  disabled={addState === "adding"}
                >
                  キャンセル
                </Button>
                <Button size="sm" onClick={handleAddVocabulary} disabled={addState === "adding"}>
                  {addState === "adding" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  追加
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        <div className="flex shrink-0 gap-1">
          <Button
            variant={feedback === "good" ? "default" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => onFeedback("good")}
            disabled={!!feedback}
          >
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button
            variant={feedback === "bad" ? "destructive" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => onFeedback("bad")}
            disabled={!!feedback}
          >
            <ThumbsDown className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
