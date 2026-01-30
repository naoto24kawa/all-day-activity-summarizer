import type { AiProcessingLog, AiProcessType } from "@repo/types";
import { Brain, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiProcessingLogs } from "@/hooks/use-ai-processing-logs";

interface AiProcessingLogPanelProps {
  date: string;
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
};

export function AiProcessingLogPanel({ date }: AiProcessingLogPanelProps) {
  const [filter, setFilter] = useState<AiProcessType | "all">("all");

  const { logs, loading, error, refetch } = useAiProcessingLogs({
    date,
    processType: filter === "all" ? undefined : filter,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          AI Processing Logs
          {!loading && <Badge variant="secondary">{logs.length}</Badge>}
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={refetch} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as AiProcessType | "all")}>
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="all">All</TabsTrigger>
            {Object.entries(PROCESS_TYPE_LABELS).map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
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
