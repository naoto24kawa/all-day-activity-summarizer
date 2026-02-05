/**
 * AI Settings Panel
 *
 * Summarizer、Rate Limit、AI Provider の設定を個別パネルで表示
 */

import type { RateLimitStatus } from "@repo/types";
import { Activity, BrainCircuit, Clock, Gauge, RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { useConfig } from "@/hooks/use-config";
import { useRateLimit } from "@/hooks/use-rate-limit";
import { fetchAdasApi } from "@/lib/adas-api";
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

/** Summarizer スケジュール設定パネル */
interface SummarizerSchedulePanelProps {
  className?: string;
}

function SummarizerSchedulePanel({ className }: SummarizerSchedulePanelProps) {
  const { integrations, loading, error, updating, updateSummarizerConfig } = useConfig();
  const [dailyScheduleHour, setDailyScheduleHour] = useState("23");
  const [timesIntervalMinutes, setTimesIntervalMinutes] = useState("0");

  useEffect(() => {
    if (integrations?.summarizer) {
      setDailyScheduleHour(String(integrations.summarizer.dailyScheduleHour ?? 23));
      setTimesIntervalMinutes(String(integrations.summarizer.timesIntervalMinutes ?? 0));
    }
  }, [integrations?.summarizer]);

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
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            サマリ スケジュール
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !integrations) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            サマリ スケジュール
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error || "設定を読み込めません"}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          サマリ スケジュール
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Daily サマリ自動実行時間 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-sm">Daily サマリ</Label>
            <Select
              value={dailyScheduleHour}
              onValueChange={handleDailyScheduleHourChange}
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
            <Label className="flex items-center gap-1.5 text-sm">Times サマリ</Label>
            <Select
              value={timesIntervalMinutes}
              onValueChange={handleTimesIntervalChange}
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
      </CardContent>
    </Card>
  );
}

/** Rate Limit 設定パネル */
interface RateLimitPanelProps {
  className?: string;
}

function RateLimitPanel({ className }: RateLimitPanelProps) {
  const { integrations, loading, error, updating, updateRateLimitConfig } = useConfig();
  const { status: rateLimitStatus, refetch: refetchRateLimit } = useRateLimit();

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" />
            Rate Limit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !integrations) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" />
            Rate Limit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error || "設定を読み込めません"}</p>
        </CardContent>
      </Card>
    );
  }

  const rateLimitEnabled = integrations.rateLimit?.enabled ?? true;
  const hasWarning = checkHasWarning(rateLimitStatus, rateLimitEnabled);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" />
            Rate Limit
            {hasWarning && <span className="text-xs text-amber-500 font-normal">(Warning)</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            {rateLimitEnabled && (
              <Button variant="ghost" size="icon" onClick={refetchRateLimit} className="h-7 w-7">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Switch
              checked={rateLimitEnabled}
              onCheckedChange={(checked) => updateRateLimitConfig({ enabled: checked })}
              disabled={updating}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

/** 処理別プロバイダー設定の定義 */
const PROVIDER_SETTINGS = [
  { key: "summarize", label: "サマリ生成" },
  { key: "suggestTags", label: "タグ提案" },
  { key: "evaluate", label: "品質評価" },
  { key: "interpret", label: "音声解釈" },
  { key: "checkCompletion", label: "完了判定" },
  { key: "analyzeProfile", label: "プロフィール" },
  { key: "extractLearnings", label: "学び抽出" },
  { key: "taskExtract", label: "タスク抽出" },
  { key: "slackPriority", label: "Slack優先度" },
] as const;

/** AI Provider 設定パネル */
interface AIProviderPanelProps {
  className?: string;
}

function AIProviderPanel({ className }: AIProviderPanelProps) {
  const { integrations, loading, error, updating, updateAIProviderConfig } = useConfig();
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  // URL変更時にモデル一覧を取得
  const fetchModels = useCallback(async (url: string) => {
    if (!url) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    try {
      const data = await fetchAdasApi<{ models: string[] }>(
        `/api/config/lmstudio/models?url=${encodeURIComponent(url)}`,
      );
      setModels(data.models);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  // integrations 変更時に urlInput を同期
  useEffect(() => {
    if (integrations?.aiProvider?.lmstudio.url) {
      setUrlInput(integrations.aiProvider.lmstudio.url);
    }
  }, [integrations?.aiProvider?.lmstudio.url]);

  // 初期ロード時にモデル一覧を取得
  useEffect(() => {
    if (integrations?.aiProvider?.lmstudio.url) {
      fetchModels(integrations.aiProvider.lmstudio.url);
    }
  }, [integrations?.aiProvider?.lmstudio.url, fetchModels]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4" />
            AI Provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !integrations?.aiProvider) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4" />
            AI Provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error || "設定を読み込めません"}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="h-4 w-4" />
          AI Provider
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          各処理で使用する LLM プロバイダーを個別に設定
        </p>

        {/* LM Studio 接続設定 */}
        <div className="space-y-3 pl-4 border-l-2 border-muted">
          <div className="space-y-1.5">
            <Label htmlFor="ai-lmstudio-url" className="text-sm">
              LM Studio URL
            </Label>
            <Input
              id="ai-lmstudio-url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={(e) => {
                if (e.target.value !== integrations.aiProvider.lmstudio.url) {
                  updateAIProviderConfig({ lmstudio: { url: e.target.value } });
                  fetchModels(e.target.value);
                }
              }}
              placeholder="http://192.168.1.17:1234"
            />
          </div>

          {/* モデル選択 */}
          <div className="space-y-1.5">
            <Label htmlFor="ai-lmstudio-model" className="text-sm">
              Model
            </Label>
            <Select
              value={integrations.aiProvider.lmstudio.model || ""}
              onValueChange={(value) => updateAIProviderConfig({ lmstudio: { model: value } })}
              disabled={updating || loadingModels || models.length === 0}
            >
              <SelectTrigger id="ai-lmstudio-model">
                <SelectValue placeholder={loadingModels ? "Loading..." : "Select model"} />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingModels && models.length === 0 && urlInput && (
              <p className="text-xs text-muted-foreground">
                LM Studio に接続できません。URL を確認してください
              </p>
            )}
          </div>

          {/* フォールバック設定 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="ai-fallback-toggle" className="text-sm">
                フォールバック
              </Label>
              <p className="text-xs text-muted-foreground">
                LM Studio 失敗時に Claude へ自動切り替え
              </p>
            </div>
            <Switch
              id="ai-fallback-toggle"
              checked={integrations.aiProvider.enableFallback}
              onCheckedChange={(checked) => updateAIProviderConfig({ enableFallback: checked })}
              disabled={updating}
            />
          </div>
        </div>

        {/* 各処理の provider 設定 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">処理別プロバイダー</Label>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_SETTINGS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between p-2 rounded border">
                <span className="text-xs">{label}</span>
                <Select
                  value={integrations.aiProvider.providers[key]}
                  onValueChange={(value: "claude" | "lmstudio") =>
                    updateAIProviderConfig({ providers: { [key]: value } })
                  }
                  disabled={updating}
                >
                  <SelectTrigger className="w-24 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="lmstudio">LM Studio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">※ 設定変更後は Worker の再起動が必要です</p>
        </div>
      </CardContent>
    </Card>
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

interface AISettingsPanelProps {
  className?: string;
}

export function AISettingsPanel({ className }: AISettingsPanelProps) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-2", className)}>
      <div className="space-y-4">
        <SummarizerSchedulePanel />
        <RateLimitPanel />
      </div>
      <AIProviderPanel />
    </div>
  );
}
