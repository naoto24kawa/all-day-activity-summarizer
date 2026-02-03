import type { AiProcessingLog, AiProcessType, Task } from "@repo/types";
import { Brain, ListTodo, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postAdasApi } from "@/hooks/use-adas-api";
import { useAiProcessingLogs, useAiProcessingLogsStats } from "@/hooks/use-ai-processing-logs";
import { getTodayDateString } from "@/lib/date";

type AiLogExtractResult = {
  extracted: number;
  processed: number;
  skipped: number;
  unmatched: number;
  grouped: number;
  tasks: Task[];
};

interface AiProcessingLogPanelProps {
  className?: string;
}

const PROCESS_TYPE_LABELS: Record<AiProcessType, string> = {
  transcribe: "Transcribe",
  evaluate: "Evaluate",
  interpret: "Interpret",
  "extract-learnings": "Learnings",
  "explain-learning": "Explain",
  summarize: "Summarize",
  "check-completion": "Completion",
  "extract-terms": "Terms",
  "analyze-profile": "Profile",
  "suggest-tags": "Tags",
  "match-channels": "Channels",
  "slack-priority": "Slack Priority",
};

const PROCESS_TYPE_COLORS: Record<AiProcessType, string> = {
  transcribe: "text-purple-500",
  evaluate: "text-orange-500",
  interpret: "text-blue-500",
  "extract-learnings": "text-green-500",
  "explain-learning": "text-emerald-500",
  summarize: "text-cyan-500",
  "check-completion": "text-pink-500",
  "extract-terms": "text-yellow-500",
  "analyze-profile": "text-indigo-500",
  "suggest-tags": "text-amber-500",
  "match-channels": "text-teal-500",
  "slack-priority": "text-red-500",
};

export function AiProcessingLogPanel(_props: AiProcessingLogPanelProps) {
  const date = getTodayDateString();
  const [filter, setFilter] = useState<AiProcessType | "all">("all");
  const [extracting, setExtracting] = useState(false);

  const { logs, loading, error, refetch } = useAiProcessingLogs({
    date,
    processType: filter === "all" ? undefined : filter,
  });

  const { stats } = useAiProcessingLogsStats(date);

  const handleExtractTasks = async () => {
    setExtracting(true);
    try {
      const result = await postAdasApi<AiLogExtractResult>(
        "/api/tasks/extract-ai-processing-logs",
        { date },
      );
      if (result.extracted > 0) {
        toast.success(`${result.extracted} 件のタスクを抽出しました`);
      } else if (result.skipped > 0 && result.processed === 0) {
        toast.info("全て処理済みです");
      } else {
        toast.info("抽出対象のエラーがありません");
      }
    } catch (err) {
      toast.error("タスク抽出に失敗しました");
      console.error(err);
    } finally {
      setExtracting(false);
    }
  };

  // エラー件数を計算
  const errorCount = stats?.error ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          AI Processing Logs
          {!loading && <Badge variant="secondary">{logs.length}</Badge>}
        </CardTitle>
        <div className="flex items-center gap-1">
          {errorCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExtractTasks}
              disabled={extracting}
              title="エラーからタスクを抽出"
            >
              <ListTodo className="mr-1 h-4 w-4" />
              {extracting ? "抽出中..." : "タスク抽出"}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={refetch} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as AiProcessType | "all")}>
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="all" className="gap-1">
              All
              {stats && <Badge variant="secondary">{stats.total}</Badge>}
            </TabsTrigger>
            {Object.entries(PROCESS_TYPE_LABELS).map(([key, label]) => {
              const typeStats = stats?.byProcessType[key];
              const count = typeStats ? typeStats.success + typeStats.error : 0;
              const errorCount = typeStats?.error ?? 0;
              return (
                <TabsTrigger key={key} value={key} className="gap-1">
                  {label}
                  {count > 0 && (
                    <Badge variant={errorCount > 0 ? "destructive" : "secondary"}>
                      {errorCount > 0 ? `${count}/${errorCount}err` : count}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center text-sm text-muted-foreground">
            <p>{error}</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground">
            <p>No AI processing logs for this date.</p>
          </div>
        ) : (
          <div className="h-[400px] overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
            {logs.map((log) => (
              <LogEntryRow key={log.id} log={log} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogEntryRow({ log }: { log: AiProcessingLog }) {
  const date = new Date(log.createdAt);
  const time = date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  const statusColor = log.status === "success" ? "text-green-500" : "text-red-500";
  const processTypeColor = PROCESS_TYPE_COLORS[log.processType] || "text-foreground";
  const processTypeLabel = PROCESS_TYPE_LABELS[log.processType] || log.processType;

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatSize = (size: number | null, type: "in" | "out"): string => {
    if (size === null) return "";
    return `${type}:${size}`;
  };

  return (
    <div
      data-timestamp={log.createdAt}
      className="flex items-center gap-2 border-b border-border/50 py-1 last:border-0"
    >
      <span className="shrink-0 text-muted-foreground">{time}</span>
      <span className={`w-16 shrink-0 font-semibold uppercase ${statusColor}`}>
        {log.status === "success" ? "OK" : "ERR"}
      </span>
      <span className={`w-24 shrink-0 ${processTypeColor}`}>{processTypeLabel}</span>
      <span className="w-16 shrink-0 text-muted-foreground">{log.model || "-"}</span>
      <span className="w-16 shrink-0 text-right text-yellow-600">
        {formatDuration(log.durationMs)}
      </span>
      <span className="w-16 shrink-0 text-muted-foreground">{formatSize(log.inputSize, "in")}</span>
      <span className="w-16 shrink-0 text-muted-foreground">
        {formatSize(log.outputSize, "out")}
      </span>
      {log.status === "error" && log.errorMessage && (
        <span className="truncate text-red-400" title={log.errorMessage}>
          {log.errorMessage}
        </span>
      )}
    </div>
  );
}
