import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvaluatorLogs } from "@/hooks/use-evaluator-logs";

type Filter = "all" | "hallucination" | "legitimate";

interface EvaluatorLogPanelProps {
  date: string;
}

export function EvaluatorLogPanel({ date }: EvaluatorLogPanelProps) {
  const { logs, loading, error } = useEvaluatorLogs(date);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = filter === "all" ? logs : logs.filter((l) => l.judgment === filter);

  const hallucinationCount = logs.filter((l) => l.judgment === "hallucination").length;
  const legitimateCount = logs.filter((l) => l.judgment === "legitimate").length;

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
      <CardHeader>
        <CardTitle>
          実行ログ
          <Badge variant="secondary" className="ml-2">
            {logs.length}
          </Badge>
        </CardTitle>
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
              {filtered.map((log) => (
                <div key={log.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={log.judgment === "hallucination" ? "destructive" : "default"}>
                      {log.judgment === "hallucination" ? "ハルシネーション" : "正常"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      confidence: {(log.confidence * 100).toFixed(0)}%
                    </span>
                    {log.patternApplied && (
                      <Badge variant="outline" className="text-xs">
                        pattern applied
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleTimeString()}
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
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
