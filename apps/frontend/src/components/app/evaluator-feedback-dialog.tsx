import type { EvaluatorJudgment } from "@repo/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

type EvaluatorFeedbackType = "correct" | "false_positive" | "false_negative";

const FEEDBACK_OPTIONS: { value: EvaluatorFeedbackType; label: string; description: string }[] = [
  { value: "correct", label: "正しい", description: "判定は正確です" },
  {
    value: "false_positive",
    label: "誤検知",
    description: "正常なのにハルシネーションと判定された",
  },
  {
    value: "false_negative",
    label: "見逃し",
    description: "ハルシネーションなのに正常と判定された",
  },
];

const JUDGMENT_OPTIONS: { value: EvaluatorJudgment; label: string }[] = [
  { value: "hallucination", label: "ハルシネーション" },
  { value: "legitimate", label: "正常" },
  { value: "mixed", label: "混在" },
];

interface EvaluatorFeedbackDialogProps {
  open: boolean;
  currentJudgment: EvaluatorJudgment;
  onSubmit: (data: {
    rating: "good" | "bad";
    correctJudgment?: EvaluatorJudgment;
    reason?: string;
  }) => void;
  onCancel: () => void;
}

export function EvaluatorFeedbackDialog({
  open,
  currentJudgment,
  onSubmit,
  onCancel,
}: EvaluatorFeedbackDialogProps) {
  const [feedbackType, setFeedbackType] = useState<EvaluatorFeedbackType>("correct");
  const [correctJudgment, setCorrectJudgment] = useState<EvaluatorJudgment | "">(
    currentJudgment === "hallucination" ? "legitimate" : "hallucination",
  );
  const [reason, setReason] = useState("");

  const handleSubmit = () => {
    const rating = feedbackType === "correct" ? "good" : "bad";
    onSubmit({
      rating,
      correctJudgment: feedbackType !== "correct" && correctJudgment ? correctJudgment : undefined,
      reason: reason || undefined,
    });
    resetForm();
  };

  const handleCancel = () => {
    resetForm();
    onCancel();
  };

  const resetForm = () => {
    setFeedbackType("correct");
    setCorrectJudgment(currentJudgment === "hallucination" ? "legitimate" : "hallucination");
    setReason("");
  };

  const showCorrectJudgment = feedbackType !== "correct";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Evaluator フィードバック</DialogTitle>
          <DialogDescription>
            この判定結果についてのフィードバックを入力してください
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-3">
            <Label>評価</Label>
            <RadioGroup
              value={feedbackType}
              onValueChange={(v) => setFeedbackType(v as EvaluatorFeedbackType)}
            >
              {FEEDBACK_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-start space-x-3">
                  <RadioGroupItem value={option.value} id={option.value} className="mt-0.5" />
                  <div className="grid gap-0.5">
                    <Label htmlFor={option.value} className="cursor-pointer font-medium">
                      {option.label}
                    </Label>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {showCorrectJudgment && (
            <div className="space-y-2">
              <Label>正解の判定</Label>
              <RadioGroup
                value={correctJudgment}
                onValueChange={(v) => setCorrectJudgment(v as EvaluatorJudgment)}
              >
                <div className="flex flex-wrap gap-4">
                  {JUDGMENT_OPTIONS.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={option.value} id={`judgment-${option.value}`} />
                      <Label
                        htmlFor={`judgment-${option.value}`}
                        className="cursor-pointer text-sm font-normal"
                      >
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
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
