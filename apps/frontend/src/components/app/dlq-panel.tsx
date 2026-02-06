/**
 * DLQ Panel
 *
 * Dead Letter Queue の一覧表示と操作
 */

import type { DLQJob, DLQOriginalQueue, DLQStatus } from "@repo/types";
import { AlertTriangle, CheckCircle, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDLQ } from "@/hooks/use-dlq";
import { cn } from "@/lib/utils";

interface DLQPanelProps {
  className?: string;
}

const QUEUE_LABELS: Record<DLQOriginalQueue, string> = {
  ai_job: "AI Job",
  slack: "Slack",
  github: "GitHub",
  claude_code: "Claude Code",
  notion: "Notion",
  calendar: "Calendar",
  summary: "Summary",
};

const STATUS_CONFIG: Record<
  DLQStatus,
  { label: string; variant: "destructive" | "secondary" | "outline" }
> = {
  dead: { label: "Dead", variant: "destructive" },
  retried: { label: "Retried", variant: "secondary" },
  ignored: { label: "Ignored", variant: "outline" },
};

export function DLQPanel({ className }: DLQPanelProps) {
  const [statusFilter, setStatusFilter] = useState<DLQStatus | "all">("dead");
  const [queueFilter, setQueueFilter] = useState<DLQOriginalQueue | "all">("all");
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());

  const { jobs, stats, isLoading, error, refetch, retryJob, ignoreJob } = useDLQ({
    status: statusFilter === "all" ? undefined : statusFilter,
    queue: queueFilter === "all" ? undefined : queueFilter,
  });

  const handleRetry = async (job: DLQJob) => {
    setProcessingIds((prev) => new Set(prev).add(job.id));
    try {
      const result = await retryJob(job.id);
      if (!result.success) {
        console.error("Retry failed:", result.error);
      }
    } catch (err) {
      console.error("Retry error:", err);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const handleIgnore = async (job: DLQJob) => {
    setProcessingIds((prev) => new Set(prev).add(job.id));
    try {
      await ignoreJob(job.id);
    } catch (err) {
      console.error("Ignore error:", err);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Stats Card */}
      {stats && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" />
              Dead Letter Queue
            </CardTitle>
            <CardDescription>最終失敗したジョブの管理</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">Total:</span>
                <Badge variant="outline">{stats.total}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">Dead:</span>
                <Badge variant="destructive">{stats.dead}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">Retried:</span>
                <Badge variant="secondary">{stats.retried}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">Ignored:</span>
                <Badge variant="outline">{stats.ignored}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Status:</span>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as DLQStatus | "all")}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="dead">Dead</SelectItem>
              <SelectItem value="retried">Retried</SelectItem>
              <SelectItem value="ignored">Ignored</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Queue:</span>
          <Select
            value={queueFilter}
            onValueChange={(v) => setQueueFilter(v as DLQOriginalQueue | "all")}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {Object.entries(QUEUE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}

      {/* Jobs Table */}
      <Card className="flex-1 overflow-hidden">
        <CardContent className="overflow-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-28">Queue</TableHead>
                <TableHead className="w-32">Job Type</TableHead>
                <TableHead className="w-36">Failed At</TableHead>
                <TableHead className="w-16">Retries</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    {isLoading ? "Loading..." : "No DLQ jobs found"}
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job) => {
                  const statusConfig = STATUS_CONFIG[job.status as DLQStatus];
                  const isProcessing = processingIds.has(job.id);
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {QUEUE_LABELS[job.originalQueue as DLQOriginalQueue]}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{job.jobType}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(job.failedAt)}
                      </TableCell>
                      <TableCell className="text-center">{job.retryCount}</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="line-clamp-1 max-w-xs cursor-help text-xs">
                                {job.errorMessage}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md">
                              <p className="whitespace-pre-wrap text-xs">{job.errorMessage}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        {job.status === "dead" && (
                          <div className="flex gap-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => handleRetry(job)}
                                    disabled={isProcessing}
                                  >
                                    {isProcessing ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <RotateCcw className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>再実行</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => handleIgnore(job)}
                                    disabled={isProcessing}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>無視</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        )}
                        {job.status === "retried" && (
                          <CheckCircle className="text-muted-foreground h-4 w-4" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
