/**
 * AI Settings Panel
 *
 * Summarizer と Rate Limit の設定を統合
 */

import type { RateLimitStatus } from "@repo/types";
import { Activity, Bot, Check, Clock, Gauge, Loader2, RefreshCw, X, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { IntegrationsConfig } from "@/hooks/use-config";
import { useConfig } from "@/hooks/use-config";
import { useRateLimit } from "@/hooks/use-rate-limit";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";
import { cn } from "@/lib/utils";

/** 時間選択用の定数配列 (0-23時) */
const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, "0")}:00 以降`,
}));

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

/** Summarizer 設定セクション */
interface SummarizerSectionProps {
  integrations: IntegrationsConfig;
  updating: boolean;
  onProviderChange: (provider: "claude" | "lmstudio") => Promise<void>;
  onLmStudioUrlBlur: () => Promise<void>;
  onLmStudioModelChange: (model: string) => Promise<void>;
  onDailyScheduleHourChange: (value: string) => Promise<void>;
  onTimesIntervalChange: (value: string) => Promise<void>;
  lmStudioUrl: string;
  setLmStudioUrl: (url: string) => void;
  lmStudioModels: string[];
  lmStudioModel: string;
  loadingModels: boolean;
  testingConnection: boolean;
  connectionStatus: "idle" | "success" | "error";
  onTestConnection: () => Promise<void>;
  dailyScheduleHour: string;
  timesIntervalMinutes: string;
}

function SummarizerSection({
  integrations,
  updating,
  onProviderChange,
  onLmStudioUrlBlur,
  onLmStudioModelChange,
  onDailyScheduleHourChange,
  onTimesIntervalChange,
  lmStudioUrl,
  setLmStudioUrl,
  lmStudioModels,
  lmStudioModel,
  loadingModels,
  testingConnection,
  connectionStatus,
  onTestConnection,
  dailyScheduleHour,
  timesIntervalMinutes,
}: SummarizerSectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Bot className="h-4 w-4" />
        Summarizer
      </h3>

      <RadioGroup
        value={integrations.summarizer.provider}
        onValueChange={onProviderChange}
        className="flex gap-4"
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="claude" id="provider-claude" disabled={updating} />
          <Label htmlFor="provider-claude" className="cursor-pointer">
            Claude (Worker経由)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="lmstudio" id="provider-lmstudio" disabled={updating} />
          <Label htmlFor="provider-lmstudio" className="cursor-pointer">
            LM Studio
          </Label>
        </div>
      </RadioGroup>

      {integrations.summarizer.provider === "lmstudio" && (
        <div className="space-y-3 pl-4 border-l-2 border-muted">
          <div className="space-y-1.5">
            <Label htmlFor="lmstudio-url" className="text-sm">
              URL
            </Label>
            <div className="flex gap-2">
              <Input
                id="lmstudio-url"
                value={lmStudioUrl}
                onChange={(e) => setLmStudioUrl(e.target.value)}
                onBlur={onLmStudioUrlBlur}
                placeholder="http://192.168.1.17:1234"
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={onTestConnection}
                disabled={testingConnection || !lmStudioUrl}
              >
                {testingConnection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : connectionStatus === "success" ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : connectionStatus === "error" ? (
                  <X className="h-4 w-4 text-destructive" />
                ) : (
                  "Test"
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lmstudio-model" className="text-sm">
              Model
            </Label>
            <Select
              value={lmStudioModel}
              onValueChange={onLmStudioModelChange}
              disabled={loadingModels || lmStudioModels.length === 0}
            >
              <SelectTrigger id="lmstudio-model">
                <SelectValue placeholder={loadingModels ? "Loading..." : "Select a model"} />
              </SelectTrigger>
              <SelectContent>
                {lmStudioModels.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lmStudioModels.length === 0 && !loadingModels && (
              <p className="text-xs text-muted-foreground">
                接続テストを実行してモデル一覧を取得してください
              </p>
            )}
          </div>
        </div>
      )}

      {/* Schedule Settings */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Daily サマリ自動実行時間 */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-sm">
            <Clock className="h-3.5 w-3.5" />
            Daily サマリ
          </Label>
          <Select
            value={dailyScheduleHour}
            onValueChange={onDailyScheduleHourChange}
            disabled={updating}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((hour) => (
                <SelectItem key={hour.value} value={hour.value}>
                  {hour.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Times サマリ自動生成間隔 */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-sm">
            <Clock className="h-3.5 w-3.5" />
            Times サマリ
          </Label>
          <Select
            value={timesIntervalMinutes}
            onValueChange={onTimesIntervalChange}
            disabled={updating}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">無効</SelectItem>
              <SelectItem value="15">15分毎</SelectItem>
              <SelectItem value="30">30分毎</SelectItem>
              <SelectItem value="60">1時間毎</SelectItem>
              <SelectItem value="120">2時間毎</SelectItem>
              <SelectItem value="180">3時間毎</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

/** Rate Limit 設定セクション */
interface RateLimitSectionProps {
  rateLimitEnabled: boolean;
  rateLimitStatus: RateLimitStatus | null;
  hasWarning: boolean;
  updating: boolean;
  onRefetch: () => void;
  onToggle: (enabled: boolean) => void;
}

function RateLimitSection({
  rateLimitEnabled,
  rateLimitStatus,
  hasWarning,
  updating,
  onRefetch,
  onToggle,
}: RateLimitSectionProps) {
  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Gauge className="h-4 w-4" />
          Rate Limit
          {hasWarning && <span className="text-xs text-amber-500 font-normal">(Warning)</span>}
        </h3>
        <div className="flex items-center gap-2">
          {rateLimitEnabled && (
            <Button variant="ghost" size="icon" onClick={onRefetch} className="h-7 w-7">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Switch checked={rateLimitEnabled} onCheckedChange={onToggle} disabled={updating} />
        </div>
      </div>

      {rateLimitEnabled && rateLimitStatus && (
        <div className="space-y-4">
          {/* Requests Section */}
          <div className="space-y-3">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              Requests
            </h4>
            <div className="space-y-2.5 pl-4">
              <UsageRow
                label="/ minute"
                current={rateLimitStatus.currentUsage.requestsPerMinute}
                limit={rateLimitStatus.limits.requestsPerMinute}
                percent={rateLimitStatus.usagePercent.requestsPerMinute}
                icon={<Clock className="h-3 w-3" />}
              />
              <UsageRow
                label="/ hour"
                current={rateLimitStatus.currentUsage.requestsPerHour}
                limit={rateLimitStatus.limits.requestsPerHour}
                percent={rateLimitStatus.usagePercent.requestsPerHour}
                icon={<Clock className="h-3 w-3" />}
              />
              <UsageRow
                label="/ day"
                current={rateLimitStatus.currentUsage.requestsPerDay}
                limit={rateLimitStatus.limits.requestsPerDay}
                percent={rateLimitStatus.usagePercent.requestsPerDay}
                icon={<Clock className="h-3 w-3" />}
              />
            </div>
          </div>

          {/* Tokens Section */}
          <div className="space-y-3">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Tokens
            </h4>
            <div className="space-y-2.5 pl-4">
              <UsageRow
                label="/ minute"
                current={rateLimitStatus.currentUsage.tokensPerMinute}
                limit={rateLimitStatus.limits.tokensPerMinute}
                percent={rateLimitStatus.usagePercent.tokensPerMinute}
                icon={<Clock className="h-3 w-3" />}
              />
              <UsageRow
                label="/ hour"
                current={rateLimitStatus.currentUsage.tokensPerHour}
                limit={rateLimitStatus.limits.tokensPerHour}
                percent={rateLimitStatus.usagePercent.tokensPerHour}
                icon={<Clock className="h-3 w-3" />}
              />
              <UsageRow
                label="/ day"
                current={rateLimitStatus.currentUsage.tokensPerDay}
                limit={rateLimitStatus.limits.tokensPerDay}
                percent={rateLimitStatus.usagePercent.tokensPerDay}
                icon={<Clock className="h-3 w-3" />}
              />
            </div>
          </div>
        </div>
      )}

      {!rateLimitEnabled && (
        <p className="text-sm text-muted-foreground">
          レート制限は無効です。予期しない過剰使用を防ぐため、有効化を推奨します。
        </p>
      )}
    </div>
  );
}

/** 警告状態を判定 (70%以上) */
function checkHasWarning(
  rateLimitStatus: RateLimitStatus | null,
  rateLimitEnabled: boolean,
): boolean {
  if (!rateLimitStatus || !rateLimitEnabled) return false;
  return (
    rateLimitStatus.usagePercent.requestsPerMinute >= 70 ||
    rateLimitStatus.usagePercent.requestsPerHour >= 70 ||
    rateLimitStatus.usagePercent.requestsPerDay >= 70 ||
    rateLimitStatus.usagePercent.tokensPerMinute >= 70 ||
    rateLimitStatus.usagePercent.tokensPerHour >= 70 ||
    rateLimitStatus.usagePercent.tokensPerDay >= 70
  );
}

/** LM Studio 接続管理用のカスタムフック */
function useLmStudioConnection(integrationsUrl: string | undefined) {
  const [lmStudioUrl, setLmStudioUrl] = useState("");
  const [lmStudioModels, setLmStudioModels] = useState<string[]>([]);
  const [lmStudioModel, setLmStudioModel] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchLmStudioModels = useCallback(async (url: string) => {
    if (!url) return;
    setLoadingModels(true);
    try {
      const data = await fetchAdasApi<{ models: string[] }>(
        `/api/config/lmstudio/models?url=${encodeURIComponent(url)}`,
      );
      setLmStudioModels(data.models);
      setConnectionStatus("success");
    } catch {
      setLmStudioModels([]);
      setConnectionStatus("error");
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setTestingConnection(true);
    setConnectionStatus("idle");
    try {
      const data = await postAdasApi<{ success: boolean; error?: string }>(
        "/api/config/lmstudio/test",
        { url: lmStudioUrl },
      );
      if (data.success) {
        setConnectionStatus("success");
        await fetchLmStudioModels(lmStudioUrl);
      } else {
        setConnectionStatus("error");
      }
    } catch {
      setConnectionStatus("error");
    } finally {
      setTestingConnection(false);
    }
  }, [lmStudioUrl, fetchLmStudioModels]);

  return {
    lmStudioUrl,
    setLmStudioUrl,
    lmStudioModels,
    lmStudioModel,
    setLmStudioModel,
    testingConnection,
    connectionStatus,
    loadingModels,
    testConnection,
    integrationsUrl,
  };
}

export function AISettingsPanel() {
  const { integrations, loading, error, updating, updateSummarizerConfig, updateRateLimitConfig } =
    useConfig();
  const { status: rateLimitStatus, refetch: refetchRateLimit } = useRateLimit();

  // LM Studio 接続管理
  const lmStudio = useLmStudioConnection(integrations?.summarizer.lmstudio.url);

  // スケジュール設定
  const [dailyScheduleHour, setDailyScheduleHour] = useState("23");
  const [timesIntervalMinutes, setTimesIntervalMinutes] = useState("0");

  // 初期値を設定
  useEffect(() => {
    if (integrations?.summarizer) {
      lmStudio.setLmStudioUrl(integrations.summarizer.lmstudio.url);
      lmStudio.setLmStudioModel(integrations.summarizer.lmstudio.model);
      setDailyScheduleHour(String(integrations.summarizer.dailyScheduleHour ?? 23));
      setTimesIntervalMinutes(String(integrations.summarizer.timesIntervalMinutes ?? 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrations?.summarizer]);

  const handleProviderChange = useCallback(
    async (provider: "claude" | "lmstudio") => {
      try {
        await updateSummarizerConfig({ provider });
      } catch {
        // エラーはhook内で処理済み
      }
    },
    [updateSummarizerConfig],
  );

  const handleLmStudioUrlBlur = useCallback(async () => {
    if (lmStudio.lmStudioUrl !== integrations?.summarizer.lmstudio.url) {
      try {
        await updateSummarizerConfig({ lmstudio: { url: lmStudio.lmStudioUrl } });
      } catch {
        // エラーはhook内で処理済み
      }
    }
  }, [lmStudio.lmStudioUrl, integrations?.summarizer.lmstudio.url, updateSummarizerConfig]);

  const handleLmStudioModelChange = useCallback(
    async (model: string) => {
      lmStudio.setLmStudioModel(model);
      try {
        await updateSummarizerConfig({ lmstudio: { model } });
      } catch {
        // エラーはhook内で処理済み
      }
    },
    [lmStudio, updateSummarizerConfig],
  );

  const handleDailyScheduleHourChange = useCallback(
    async (value: string) => {
      setDailyScheduleHour(value);
      try {
        await updateSummarizerConfig({ dailyScheduleHour: Number.parseInt(value, 10) });
      } catch {
        // エラーはhook内で処理済み
      }
    },
    [updateSummarizerConfig],
  );

  const handleTimesIntervalChange = useCallback(
    async (value: string) => {
      setTimesIntervalMinutes(value);
      try {
        await updateSummarizerConfig({ timesIntervalMinutes: Number.parseInt(value, 10) });
      } catch {
        // エラーはhook内で処理済み
      }
    },
    [updateSummarizerConfig],
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!integrations) {
    return null;
  }

  const rateLimitEnabled = integrations.rateLimit?.enabled ?? true;
  const hasWarning = checkHasWarning(rateLimitStatus, rateLimitEnabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Settings
          {hasWarning && <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-amber-500" />}
        </CardTitle>
        <CardDescription>サマリー生成とレート制限の設定</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SummarizerSection
          integrations={integrations}
          updating={updating}
          onProviderChange={handleProviderChange}
          onLmStudioUrlBlur={handleLmStudioUrlBlur}
          onLmStudioModelChange={handleLmStudioModelChange}
          onDailyScheduleHourChange={handleDailyScheduleHourChange}
          onTimesIntervalChange={handleTimesIntervalChange}
          lmStudioUrl={lmStudio.lmStudioUrl}
          setLmStudioUrl={lmStudio.setLmStudioUrl}
          lmStudioModels={lmStudio.lmStudioModels}
          lmStudioModel={lmStudio.lmStudioModel}
          loadingModels={lmStudio.loadingModels}
          testingConnection={lmStudio.testingConnection}
          connectionStatus={lmStudio.connectionStatus}
          onTestConnection={lmStudio.testConnection}
          dailyScheduleHour={dailyScheduleHour}
          timesIntervalMinutes={timesIntervalMinutes}
        />

        <RateLimitSection
          rateLimitEnabled={rateLimitEnabled}
          rateLimitStatus={rateLimitStatus}
          hasWarning={hasWarning}
          updating={updating}
          onRefetch={refetchRateLimit}
          onToggle={(checked) => updateRateLimitConfig({ enabled: checked })}
        />
      </CardContent>
    </Card>
  );
}
