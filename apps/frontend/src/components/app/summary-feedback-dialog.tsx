import type { FeedbackRating, SummaryIssueType } from "@repo/types";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ISSUE_OPTIONS: { value: SummaryIssueType; label: string }[] = [
  { value: "info_missing", label: "情報不足" },
  { value: "too_verbose", label: "冗長" },
  { value: "incorrect", label: "誤り" },
  { value: "bad_structure", label: "構成が悪い" },
];

interface SummaryFeedbackDialogProps {
  open: boolean;
  rating: FeedbackRating;
  onSubmit: (data: {
    issues?: SummaryIssueType[];
    reason?: string;
    correctedText?: string;
  }) => void;
  onCancel: () => void;
}

export function SummaryFeedbackDialog({
  open,
  rating,
  onSubmit,
  onCancel,
}: SummaryFeedbackDialogProps) {
  const [selectedIssues, setSelectedIssues] = useState<SummaryIssueType[]>([]);
  const [reason, setReason] = useState("");
  const [correctedText, setCorrectedText] = useState("");

  const handleSubmit = () => {
    onSubmit({
      issues: selectedIssues.length > 0 ? selectedIssues : undefined,
      reason: reason || undefined,
      correctedText: correctedText || undefined,
    });
    resetForm();
  };

  const handleCancel = () => {
    resetForm();
    onCancel();
  };

  const resetForm = () => {
    setSelectedIssues([]);
    setReason("");
    setCorrectedText("");
  };

  const toggleIssue = (issue: SummaryIssueType) => {
    setSelectedIssues((prev) =>
      prev.includes(issue) ? prev.filter((i) => i !== issue) : [...prev, issue],
    );
  };

  // Command+Enter (Mac) / Ctrl+Enter (Windows) で送信
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const getRatingLabel = () => {
    switch (rating) {
      case "good":
        return "Good";
      case "neutral":
        return "普通";
      case "bad":
        return "Bad";
    }
  };

  const getRatingDescription = () => {
    switch (rating) {
      case "good":
        return "この要約の良かった点を教えてください";
      case "neutral":
        return "この要約についてのフィードバックを入力してください";
      case "bad":
        return "この要約の問題点を教えてください";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{getRatingLabel()} フィードバック</DialogTitle>
          <DialogDescription>{getRatingDescription()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {rating !== "good" && (
            <div className="space-y-2">
              <Label>問題点 (複数選択可)</Label>
              <div className="flex flex-wrap gap-3">
                {ISSUE_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={option.value}
                      checked={selectedIssues.includes(option.value)}
                      onCheckedChange={() => toggleIssue(option.value)}
                    />
                    <Label htmlFor={option.value} className="cursor-pointer text-sm font-normal">
                      {option.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">理由 (任意)</Label>
            <Textarea
              id="reason"
              placeholder="理由を入力..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          {rating !== "good" && (
            <div className="space-y-2">
              <Label htmlFor="corrected">修正版テキスト (任意)</Label>
              <Textarea
                id="corrected"
                placeholder="あるべき内容を入力..."
                value={correctedText}
                onChange={(e) => setCorrectedText(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit}>送信</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
