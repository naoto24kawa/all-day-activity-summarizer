import { RefreshCw, Server, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LogEntry, LogSource } from "@/hooks/use-server-logs";
import { useServerLogs } from "@/hooks/use-server-logs";

interface ServerLogsPanelProps {
  date: string;
}

export function ServerLogsPanel({ date }: ServerLogsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          Server Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="serve">
          <TabsList>
            <TabsTrigger value="serve" className="flex items-center gap-1">
              <Server className="h-3 w-3" />
              Serve
            </TabsTrigger>
            <TabsTrigger value="worker" className="flex items-center gap-1">
              <Terminal className="h-3 w-3" />
              Worker
            </TabsTrigger>
          </TabsList>
          <TabsContent value="serve">
            <LogView source="serve" date={date} />
          </TabsContent>
          <TabsContent value="worker">
            <LogView source="worker" date={date} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function LogView({ source, date }: { source: LogSource; date: string }) {
  const { entries, loading, error, refetch } = useServerLogs(source, date);

  if (loading) {
    return (
      <div className="space-y-2 pt-4">
        {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
          <Skeleton key={id} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="pt-4 text-center text-sm text-muted-foreground">
        <p>{error}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="pt-4 text-center text-sm text-muted-foreground">
        <p>No logs for this date.</p>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <div className="mb-2 flex items-center justify-between">
        <Badge variant="secondary">{entries.length} entries</Badge>
        <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="h-[500px] overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
        {entries.map((entry, index) => (
          <LogEntryRow key={`${entry.timestamp}-${index}`} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const time = entry.timestamp.split("T")[1]?.slice(0, 12) || "";
  const levelColor = getLevelColor(entry.level);

  return (
    <div className="flex gap-2 border-b border-border/50 py-1 last:border-0">
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
