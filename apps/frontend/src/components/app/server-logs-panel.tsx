import { Bot, Cpu, Radio, RefreshCw, Server, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogEntry, LogSource } from "@/hooks/use-server-logs";
import { useServerLogs } from "@/hooks/use-server-logs";
import { getTodayDateString } from "@/lib/date";

type ServerLogsPanelProps = {};

export function ServerLogsPanel(_props: ServerLogsPanelProps) {
  const date = getTodayDateString();
  const serveData = useServerLogs("serve", date);
  const sseServerData = useServerLogs("sse-server", date);
  const aiWorkerData = useServerLogs("ai-worker", date);
  const localWorkerData = useServerLogs("local-worker", date);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          Server Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-4">
          <LogView
            source="serve"
            entries={serveData.entries}
            loading={serveData.loading}
            error={serveData.error}
            refetch={serveData.refetch}
          />
          <LogView
            source="sse-server"
            entries={sseServerData.entries}
            loading={sseServerData.loading}
            error={sseServerData.error}
            refetch={sseServerData.refetch}
          />
          <LogView
            source="ai-worker"
            entries={aiWorkerData.entries}
            loading={aiWorkerData.loading}
            error={aiWorkerData.error}
            refetch={aiWorkerData.refetch}
          />
          <LogView
            source="local-worker"
            entries={localWorkerData.entries}
            loading={localWorkerData.loading}
            error={localWorkerData.error}
            refetch={localWorkerData.refetch}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface LogViewProps {
  source: LogSource;
  entries: LogEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function getSourceIcon(source: LogSource) {
  switch (source) {
    case "serve":
      return <Server className="h-4 w-4" />;
    case "sse-server":
      return <Radio className="h-4 w-4" />;
    case "ai-worker":
      return <Bot className="h-4 w-4" />;
    case "local-worker":
      return <Cpu className="h-4 w-4" />;
    default:
      return <Terminal className="h-4 w-4" />;
  }
}

function getSourceTitle(source: LogSource) {
  switch (source) {
    case "serve":
      return "CLI API";
    case "sse-server":
      return "SSE Server";
    case "ai-worker":
      return "AI Worker";
    case "local-worker":
      return "Local Worker";
    default:
      return "Worker";
  }
}

function LogView({ source, entries, loading, error, refetch }: LogViewProps) {
  const icon = getSourceIcon(source);
  const title = getSourceTitle(source);

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium">{title}</span>
          {!loading && <Badge variant="secondary">{entries.length}</Badge>}
        </div>
        <Button variant="ghost" size="icon" onClick={refetch} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-8 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center text-sm text-muted-foreground">
          <p>{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground">
          <p>No logs for this date.</p>
        </div>
      ) : (
        <div className="h-[400px] overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
          {entries.map((entry, index) => (
            <LogEntryRow key={`${entry.timestamp}-${index}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  // UTC から ローカルタイムに変換して表示
  const date = new Date(entry.timestamp);
  const time = date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  const levelColor = getLevelColor(entry.level);

  return (
    <div
      data-timestamp={entry.timestamp}
      className="flex gap-2 border-b border-border/50 py-1 last:border-0"
    >
      <span className="shrink-0 text-muted-foreground">{time}</span>
      <span className={`shrink-0 font-semibold ${levelColor}`}>{entry.level.padEnd(5)}</span>
      <span className="break-all">{entry.message}</span>
    </div>
  );
}

function getLevelColor(level: string): string {
  switch (level.trim().toUpperCase()) {
    case "ERROR":
    case "FATAL":
      return "text-red-500";
    case "WARN":
      return "text-yellow-500";
    case "INFO":
      return "text-blue-500";
    case "DEBUG":
      return "text-gray-500";
    default:
      return "text-foreground";
  }
}
