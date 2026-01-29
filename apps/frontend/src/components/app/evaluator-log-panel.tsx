import type { EvaluatorJudgment, EvaluatorLog } from "@repo/types";
import { MessageSquare, RefreshCw } from "lucide-react";
import { useState } from "react";
import { EvaluatorFeedbackDialog } from "@/components/app/evaluator-feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvaluatorLogs } from "@/hooks/use-evaluator-logs";
import { useFeedbacks } from "@/hooks/use-feedbacks";
import { formatTimeJST } from "@/lib/date";

type Filter = "all" | "hallucination" | "legitimate";

interface EvaluatorLogPanelProps {
  date: string;
}

export function EvaluatorLogPanel({ date }: EvaluatorLogPanelProps) {
  const { logs, loading, error, refetch } = useEvaluatorLogs(date);
  const { getFeedback, postFeedback } = useFeedbacks("evaluator_log", date);
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingFeedback, setPendingFeedback] = useState<{
    logId: number;
    currentJudgment: EvaluatorJudgment;
  } | null>(null);

  const sorted = [...logs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const filtered = filter === "all" ? sorted : sorted.filter((l) => l.judgment === filter);

  const hallucinationCount = logs.filter((l) => l.judgment === "hallucination").length;
  const legitimateCount = logs.filter((l) => l.judgment === "legitimate").length;

  const handleFeedbackClick = (log: EvaluatorLog) => {
    setPendingFeedback({ logId: log.id, currentJudgment: log.judgment });
  };

  const handleFeedbackSubmit = async (data: {
    rating: "good" | "bad";
    correctJudgment?: EvaluatorJudgment;
    reason?: string;
  }) => {
    if (pendingFeedback) {
      await postFeedback({
        targetId: pendingFeedback.logId,
        rating: data.rating,
        correctJudgment: data.correctJudgment,
        reason: data.reason,
      });
      setPendingFeedback(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>実行ログ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2"].map((id) => (
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
          <CardTitle>実行ログ</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          実行ログ
          <Badge variant="secondary" className="ml-2">
            {logs.length}
          </Badge>
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex gap-1">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            すべて ({logs.length})
          </Button>
          <Button
            size="sm"
            variant={filter === "legitimate" ? "default" : "outline"}
            onClick={() => setFilter("legitimate")}
          >
            正常 ({legitimateCount})
          </Button>
          <Button
            size="sm"
            variant={filter === "hallucination" ? "destructive" : "outline"}
            onClick={() => setFilter("hallucination")}
          >
            ハルシネーション ({hallucinationCount})
          </Button>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">該当するログはありません。</p>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {filtered.map((log) => {
                const feedback = getFeedback(log.id);
                return (
                  <div key={log.id} className="rounded-md border p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant={log.judgment === "hallucination" ? "destructive" : "default"}>
                        {log.judgment === "hallucination"
                          ? "ハルシネーション"
                          : log.judgment === "mixed"
                            ? "混在"
                            : "正常"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        confidence: {(log.confidence * 100).toFixed(0)}%
                      </span>
                      {log.patternApplied && (
                        <Badge variant="outline" className="text-xs">
                          pattern applied
                        </Badge>
                      )}
                      {feedback && (
                        <Badge
                          variant={feedback.rating === "good" ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {feedback.rating === "good" ? "正しい" : "誤判定"}
                        </Badge>
                      )}
                      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        {formatTimeJST(log.createdAt)}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleFeedbackClick(log)}
                          disabled={!!feedback}
                          title="フィードバック"
                        >
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                      </span>
                    </div>
                    <p className="mb-1 text-sm">{log.reason}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {log.transcriptionText}
                    </p>
                    {log.suggestedPattern && (
                      <code className="mt-1 block text-xs text-muted-foreground">
                        pattern: {log.suggestedPattern}
                      </code>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
      {pendingFeedback && (
        <EvaluatorFeedbackDialog
          open={!!pendingFeedback}
          currentJudgment={pendingFeedback.currentJudgment}
          onSubmit={handleFeedbackSubmit}
          onCancel={() => setPendingFeedback(null)}
        />
      )}
    </Card>
  );
}
