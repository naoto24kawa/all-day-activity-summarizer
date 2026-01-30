import type { InterpretIssueType, SegmentFeedbackResponse } from "@repo/types";
import { BookPlus, Check, Loader2 } from "lucide-react";
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
import { useVocabulary } from "@/hooks/use-vocabulary";

const ISSUE_OPTIONS: { value: InterpretIssueType; label: string }[] = [
  { value: "meaning_changed", label: "意味が変わった" },
  { value: "info_lost", label: "情報が消えた" },
  { value: "wrong_conversion", label: "誤変換" },
  { value: "filler_remaining", label: "フィラー残り" },
];

interface FeedbackDialogProps {
  open: boolean;
  rating: "good" | "bad";
  onSubmit: (data: {
    reason?: string;
    issues?: InterpretIssueType[];
    correctedText?: string;
  }) => Promise<SegmentFeedbackResponse>;
  onCancel: () => void;
}

type DialogPhase = "input" | "suggestions" | "complete";

export function FeedbackDialog({ open, rating, onSubmit, onCancel }: FeedbackDialogProps) {
  const [reason, setReason] = useState("");
  const [selectedIssues, setSelectedIssues] = useState<InterpretIssueType[]>([]);
  const [correctedText, setCorrectedText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 用語候補関連
  const [phase, setPhase] = useState<DialogPhase>("input");
  const [suggestedTerms, setSuggestedTerms] = useState<string[]>([]);
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [registeringTerms, setRegisteringTerms] = useState(false);

  const { addTerm } = useVocabulary();

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await onSubmit({
        reason: reason || undefined,
        issues: selectedIssues.length > 0 ? selectedIssues : undefined,
        correctedText: correctedText || undefined,
      });

      // 用語候補がある場合は提案フェーズへ
      if (result.suggestedTerms && result.suggestedTerms.length > 0) {
        setSuggestedTerms(result.suggestedTerms);
        setSelectedTerms(result.suggestedTerms); // デフォルトで全選択
        setPhase("suggestions");
      } else {
        // 候補がなければそのまま完了
        handleClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterTerms = async () => {
    if (selectedTerms.length === 0) {
      handleClose();
      return;
    }

    setRegisteringTerms(true);
    try {
      for (const term of selectedTerms) {
        await addTerm(term, { source: "feedback" });
      }
      setPhase("complete");
      // 少し待ってからダイアログを閉じる
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch {
      // エラーでもダイアログを閉じる
      handleClose();
    } finally {
      setRegisteringTerms(false);
    }
  };

  // Command+Enter (Mac) / Ctrl+Enter (Windows) で送信
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (phase === "input" && !submitting) {
          handleSubmit();
        } else if (phase === "suggestions" && !registeringTerms) {
          handleRegisterTerms();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleSkipTerms = () => {
    handleClose();
  };

  const handleCancel = () => {
    resetFormState();
    onCancel();
  };

  const handleClose = () => {
    resetFormState();
    onCancel();
  };

  const resetFormState = () => {
    setReason("");
    setSelectedIssues([]);
    setCorrectedText("");
    setPhase("input");
    setSuggestedTerms([]);
    setSelectedTerms([]);
  };

  const toggleIssue = (issue: InterpretIssueType) => {
    setSelectedIssues((prev) =>
      prev.includes(issue) ? prev.filter((i) => i !== issue) : [...prev, issue],
    );
  };

  const toggleTerm = (term: string) => {
    setSelectedTerms((prev) =>
      prev.includes(term) ? prev.filter((t) => t !== term) : [...prev, term],
    );
  };

  // フェーズ: input (フィードバック入力)
  if (phase === "input") {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rating === "good" ? "Good" : "Bad"} Feedback</DialogTitle>
            <DialogDescription>
              {rating === "good"
                ? "この解釈の良かった点を教えてください"
                : "この解釈の問題点を教えてください"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {rating === "bad" && (
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

            {rating === "bad" && (
              <div className="space-y-2">
                <Label htmlFor="corrected">修正版テキスト (任意)</Label>
                <Textarea
                  id="corrected"
                  placeholder="正しい解釈を入力..."
                  value={correctedText}
                  onChange={(e) => setCorrectedText(e.target.value)}
                  rows={2}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleCancel}>
              キャンセル
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              送信
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // フェーズ: suggestions (用語候補の選択)
  if (phase === "suggestions") {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookPlus className="h-5 w-5" />
              単語帳に追加
            </DialogTitle>
            <DialogDescription>
              修正テキストから以下の用語が検出されました。単語帳に追加しますか?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {suggestedTerms.map((term) => (
              <div key={term} className="flex items-center space-x-3">
                <Checkbox
                  id={`term-${term}`}
                  checked={selectedTerms.includes(term)}
                  onCheckedChange={() => toggleTerm(term)}
                />
                <Label
                  htmlFor={`term-${term}`}
                  className="cursor-pointer font-mono text-sm font-medium"
                >
                  {term}
                </Label>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleSkipTerms}>
              スキップ
            </Button>
            <Button onClick={handleRegisterTerms} disabled={registeringTerms}>
              {registeringTerms && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {selectedTerms.length > 0 ? `${selectedTerms.length}件を登録` : "登録"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // フェーズ: complete (登録完了)
  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col items-center justify-center py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <Check className="h-6 w-6 text-green-600" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {selectedTerms.length}件の用語を登録しました
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
