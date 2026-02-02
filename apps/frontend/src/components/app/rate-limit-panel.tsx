/**
 * Rate Limit Panel
 *
 * レート制限の使用状況を表示
 */

import { Activity, Clock, RefreshCw, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useRateLimit } from "@/hooks/use-rate-limit";
import { cn } from "@/lib/utils";

/** 使用率からプログレスバーの色クラスを取得 */
function getProgressColorClass(percent: number): string {
  if (percent >= 90) return "[&>[data-slot=progress-indicator]]:bg-destructive";
  if (percent >= 70) return "[&>[data-slot=progress-indicator]]:bg-amber-500";
  return "[&>[data-slot=progress-indicator]]:bg-primary";
}

/** 数値をフォーマット */
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

interface UsageRowProps {
  label: string;
  current: number;
  limit: number;
  percent: number;
  icon: React.ReactNode;
}

function UsageRow({ label, current, limit, percent, icon }: UsageRowProps) {
  const colorClass = getProgressColorClass(percent);
  const displayPercent = Math.min(percent, 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-medium">
          {formatNumber(current)} / {formatNumber(limit)}
        </span>
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Progress value={displayPercent} className={cn("h-2", colorClass)} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{percent.toFixed(1)}% 使用中</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function RateLimitPanel() {
  const { status, loading, error, refetch } = useRateLimit();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rate Limit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rate Limit</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="destructive">Error</Badge>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return null;
  }

  if (!status.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Rate Limit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary">無効</Badge>
          <p className="mt-2 text-sm text-muted-foreground">レート制限は無効に設定されています</p>
        </CardContent>
      </Card>
    );
  }

  const { currentUsage, limits, usagePercent } = status;

  // 警告状態を判定 (70%以上)
  const hasWarning =
    usagePercent.requestsPerMinute >= 70 ||
    usagePercent.requestsPerHour >= 70 ||
    usagePercent.requestsPerDay >= 70 ||
    usagePercent.tokensPerMinute >= 70 ||
    usagePercent.tokensPerHour >= 70 ||
    usagePercent.tokensPerDay >= 70;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Rate Limit
          {hasWarning && (
            <Badge variant="destructive" className="ml-2">
              Warning
            </Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={refetch} className="h-8 w-8">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Requests Section */}
        <div className="space-y-3">
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Zap className="h-4 w-4" />
            Requests
          </h4>
          <div className="space-y-3 pl-5">
            <UsageRow
              label="/ minute"
              current={currentUsage.requestsPerMinute}
              limit={limits.requestsPerMinute}
              percent={usagePercent.requestsPerMinute}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
            <UsageRow
              label="/ hour"
              current={currentUsage.requestsPerHour}
              limit={limits.requestsPerHour}
              percent={usagePercent.requestsPerHour}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
            <UsageRow
              label="/ day"
              current={currentUsage.requestsPerDay}
              limit={limits.requestsPerDay}
              percent={usagePercent.requestsPerDay}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
          </div>
        </div>

        {/* Tokens Section */}
        <div className="space-y-3">
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Activity className="h-4 w-4" />
            Tokens
          </h4>
          <div className="space-y-3 pl-5">
            <UsageRow
              label="/ minute"
              current={currentUsage.tokensPerMinute}
              limit={limits.tokensPerMinute}
              percent={usagePercent.tokensPerMinute}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
            <UsageRow
              label="/ hour"
              current={currentUsage.tokensPerHour}
              limit={limits.tokensPerHour}
              percent={usagePercent.tokensPerHour}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
            <UsageRow
              label="/ day"
              current={currentUsage.tokensPerDay}
              limit={limits.tokensPerDay}
              percent={usagePercent.tokensPerDay}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
