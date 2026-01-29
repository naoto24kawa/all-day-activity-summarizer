import { RefreshCw, Server, Terminal } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogEntry, LogSource } from "@/hooks/use-server-logs";
import { useServerLogs } from "@/hooks/use-server-logs";

interface ServerLogsPanelProps {
  date: string;
}

export function ServerLogsPanel({ date }: ServerLogsPanelProps) {
  const serveData = useServerLogs("serve", date);
  const workerData = useServerLogs("worker", date);

  const serveRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<HTMLDivElement>(null);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const isScrolling = useRef(false);

  // 時刻ベースでスクロール同期
  const handleScroll = useCallback(
    (source: "serve" | "worker") => {
      if (!syncEnabled || isScrolling.current) return;

      const sourceRef = source === "serve" ? serveRef : workerRef;
      const targetRef = source === "serve" ? workerRef : serveRef;
      const targetEntries = source === "serve" ? workerData.entries : serveData.entries;

      if (!sourceRef.current || !targetRef.current || targetEntries.length === 0) return;

      // ソース側で現在表示されている最初のエントリのタイムスタンプを取得
      const sourceContainer = sourceRef.current;
      const sourceRows = sourceContainer.querySelectorAll("[data-timestamp]");

      let visibleTimestamp: string | null = null;
      for (const row of sourceRows) {
        const rect = row.getBoundingClientRect();
        const containerRect = sourceContainer.getBoundingClientRect();
        if (rect.top >= containerRect.top && rect.top < containerRect.bottom) {
          visibleTimestamp = row.getAttribute("data-timestamp");
          break;
        }
      }

      if (!visibleTimestamp) return;

      // ターゲット側で最も近いタイムスタンプのエントリを見つける
      const targetContainer = targetRef.current;
      const targetRows = targetContainer.querySelectorAll("[data-timestamp]");

      let closestRow: Element | null = null;
      let closestDiff = Infinity;

      for (const row of targetRows) {
        const ts = row.getAttribute("data-timestamp");
        if (!ts) continue;
        const diff = Math.abs(new Date(ts).getTime() - new Date(visibleTimestamp).getTime());
        if (diff < closestDiff) {
          closestDiff = diff;
          closestRow = row;
        }
      }

      if (closestRow) {
        isScrolling.current = true;
        closestRow.scrollIntoView({ block: "start" });
        // スクロール完了後にフラグをリセット
        setTimeout(() => {
          isScrolling.current = false;
        }, 100);
      }
    },
    [syncEnabled, serveData.entries, workerData.entries],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          Server Logs
        </CardTitle>
        <Button
          variant={syncEnabled ? "default" : "outline"}
          size="sm"
          onClick={() => setSyncEnabled(!syncEnabled)}
        >
          {syncEnabled ? "Time Sync ON" : "Time Sync OFF"}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2">
          <LogView
            source="serve"
            entries={serveData.entries}
            loading={serveData.loading}
            error={serveData.error}
            refetch={serveData.refetch}
            scrollRef={serveRef}
            onScroll={() => handleScroll("serve")}
          />
          <LogView
            source="worker"
            entries={workerData.entries}
            loading={workerData.loading}
            error={workerData.error}
            refetch={workerData.refetch}
            scrollRef={workerRef}
            onScroll={() => handleScroll("worker")}
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
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: () => void;
}

function LogView({ source, entries, loading, error, refetch, scrollRef, onScroll }: LogViewProps) {
  const icon =
    source === "serve" ? <Server className="h-4 w-4" /> : <Terminal className="h-4 w-4" />;
  const title = source === "serve" ? "Serve" : "Worker";

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
        <div
          ref={scrollRef as React.RefObject<HTMLDivElement>}
          onScroll={onScroll}
          className="h-[400px] overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs"
        >
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
