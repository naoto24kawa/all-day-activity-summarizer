import {
  Bot,
  Check,
  Clock,
  Github,
  Loader2,
  MessageSquare,
  Mic,
  Plug,
  Sparkles,
  Terminal,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useConfig } from "@/hooks/use-config";
import { useSummaries } from "@/hooks/use-summaries";
import { fetchAdasApi, postAdasApi } from "@/lib/adas-api";
import { getTodayDateString } from "@/lib/date";

export function IntegrationsPanel() {
  const { integrations, loading, error, updating, updateIntegration, updateSummarizerConfig } =
    useConfig();

  // LM Studio 関連の状態
  const [lmStudioUrl, setLmStudioUrl] = useState("");
  const [lmStudioModels, setLmStudioModels] = useState<string[]>([]);
  const [lmStudioModel, setLmStudioModel] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [loadingModels, setLoadingModels] = useState(false);

  // サマリー生成関連の状態
  const today = getTodayDateString();
  const { generateSummary, loading: summaryLoading } = useSummaries(today);
  const [summaryStartHour, setSummaryStartHour] = useState("9");
  const [summaryEndHour, setSummaryEndHour] = useState("18");
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Daily サマリ自動実行時間
  const [dailyScheduleHour, setDailyScheduleHour] = useState("23");

  // Times サマリ自動生成間隔
  const [timesIntervalMinutes, setTimesIntervalMinutes] = useState("0");

  // 初期値を設定
  useEffect(() => {
    if (integrations?.summarizer) {
      setLmStudioUrl(integrations.summarizer.lmstudio.url);
      setLmStudioModel(integrations.summarizer.lmstudio.model);
      setDailyScheduleHour(String(integrations.summarizer.dailyScheduleHour ?? 23));
      setTimesIntervalMinutes(String(integrations.summarizer.timesIntervalMinutes ?? 0));
    }
  }, [integrations?.summarizer]);

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

  const testLmStudioConnection = useCallback(async () => {
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
    if (lmStudioUrl !== integrations?.summarizer.lmstudio.url) {
      try {
        await updateSummarizerConfig({ lmstudio: { url: lmStudioUrl } });
      } catch {
        // エラーはhook内で処理済み
      }
    }
  }, [lmStudioUrl, integrations?.summarizer.lmstudio.url, updateSummarizerConfig]);

  const handleLmStudioModelChange = useCallback(
    async (model: string) => {
      setLmStudioModel(model);
      try {
        await updateSummarizerConfig({ lmstudio: { model } });
      } catch {
        // エラーはhook内で処理済み
      }
    },
    [updateSummarizerConfig],
  );

  const handleGenerateTimesSummary = useCallback(async () => {
    const startHour = Number.parseInt(summaryStartHour, 10);
    const endHour = Number.parseInt(summaryEndHour, 10);
    const timeRange = endHour - startHour + 1;

    setSummaryError(null);

    if (startHour > endHour) {
      setSummaryError("開始時間は終了時間以前にしてください");
      return;
    }
    if (timeRange > 12) {
      setSummaryError("時間範囲は最大12時間までです");
      return;
    }

    setGeneratingSummary(true);
    try {
      await generateSummary({ date: today, startHour, endHour });
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "サマリ生成に失敗しました");
    } finally {
      setGeneratingSummary(false);
    }
  }, [summaryStartHour, summaryEndHour, today, generateSummary]);

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
          <CardTitle>Integrations</CardTitle>
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
          <CardTitle>Integrations</CardTitle>
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

  const handleToggle = async (
    integration: "whisper" | "slack" | "github" | "claudeCode" | "evaluator" | "promptImprovement",
    enabled: boolean,
  ) => {
    try {
      const result = await updateIntegration(integration, enabled);
      if (result.requiresRestart) {
        // 再起動が必要な旨を表示 (将来的にはトースト等)
        console.log("設定を反映するにはサーバーの再起動が必要です");
      }
    } catch {
      // エラーはhook内で処理済み
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-green-500" />
          Integrations
        </CardTitle>
        <CardDescription>
          外部サービス連携の有効/無効を切り替えます。変更後はサーバーの再起動が必要です。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Whisper (文字起こし) */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="whisper-toggle" className="flex items-center gap-2 text-base">
              <Mic className="h-4 w-4" />
              Whisper (文字起こし)
            </Label>
            <p className="text-sm text-muted-foreground">
              音声の自動文字起こし ({integrations.whisper.engine}, {integrations.whisper.language})
            </p>
          </div>
          <Switch
            id="whisper-toggle"
            checked={integrations.whisper.enabled}
            onCheckedChange={(checked) => handleToggle("whisper", checked)}
            disabled={updating}
          />
        </div>

        {/* Slack */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="slack-toggle" className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" />
              Slack
            </Label>
            <p className="text-sm text-muted-foreground">
              {integrations.slack.hasCredentials
                ? "メンション・キーワード監視"
                : "認証情報未設定 (config.json で xoxcToken/xoxdToken を設定)"}
            </p>
          </div>
          <Switch
            id="slack-toggle"
            checked={integrations.slack.enabled}
            onCheckedChange={(checked) => handleToggle("slack", checked)}
            disabled={updating || !integrations.slack.hasCredentials}
          />
        </div>

        {/* GitHub */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="github-toggle" className="flex items-center gap-2 text-base">
              <Github className="h-4 w-4" />
              GitHub
            </Label>
            <p className="text-sm text-muted-foreground">
              {integrations.github.username
                ? `@${integrations.github.username} の Issue/PR 監視`
                : "gh auth login で認証してください"}
            </p>
          </div>
          <Switch
            id="github-toggle"
            checked={integrations.github.enabled}
            onCheckedChange={(checked) => handleToggle("github", checked)}
            disabled={updating}
          />
        </div>

        {/* Claude Code */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="claude-toggle" className="flex items-center gap-2 text-base">
              <Terminal className="h-4 w-4" />
              Claude Code
            </Label>
            <p className="text-sm text-muted-foreground">
              セッション履歴・学び抽出
              {integrations.claudeCode.projects.length > 0 &&
                ` (${integrations.claudeCode.projects.length} projects)`}
            </p>
          </div>
          <Switch
            id="claude-toggle"
            checked={integrations.claudeCode.enabled}
            onCheckedChange={(checked) => handleToggle("claudeCode", checked)}
            disabled={updating}
          />
        </div>

        {/* Evaluator */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="evaluator-toggle" className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              Evaluator
            </Label>
            <p className="text-sm text-muted-foreground">文字起こし品質の自動評価</p>
          </div>
          <Switch
            id="evaluator-toggle"
            checked={integrations.evaluator.enabled}
            onCheckedChange={(checked) => handleToggle("evaluator", checked)}
            disabled={updating}
          />
        </div>

        {/* Prompt Improvement */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="prompt-toggle" className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4" />
              Prompt Improvement
            </Label>
            <p className="text-sm text-muted-foreground">
              プロンプト自動改善 (フィードバックベース)
            </p>
          </div>
          <Switch
            id="prompt-toggle"
            checked={integrations.promptImprovement.enabled}
            onCheckedChange={(checked) => handleToggle("promptImprovement", checked)}
            disabled={updating}
          />
        </div>

        {/* Summarizer */}
        <div className="border-t pt-4 mt-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              <Label className="text-base">Summarizer</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              サマリー生成に使用するプロバイダーを選択します
            </p>

            <RadioGroup
              value={integrations.summarizer.provider}
              onValueChange={handleProviderChange}
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
                      onBlur={handleLmStudioUrlBlur}
                      placeholder="http://192.168.1.17:1234"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testLmStudioConnection}
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
                    onValueChange={handleLmStudioModelChange}
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

            {/* Daily サマリ自動実行時間 */}
            <div className="mt-4 space-y-3 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <Label className="text-sm">Daily サマリ自動実行</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                毎日指定した時間に Daily サマリを自動生成します
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={dailyScheduleHour}
                  onValueChange={handleDailyScheduleHourChange}
                  disabled={updating}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={`daily-${i}`} value={String(i)}>
                        {String(i).padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">以降</span>
              </div>
            </div>

            {/* Times サマリ自動生成間隔 */}
            <div className="mt-4 space-y-3 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <Label className="text-sm">Times サマリ自動生成</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                指定間隔で直近の作業サマリを自動生成します (0 = 無効)
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={timesIntervalMinutes}
                  onValueChange={handleTimesIntervalChange}
                  disabled={updating}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">無効</SelectItem>
                    <SelectItem value="30">30分毎</SelectItem>
                    <SelectItem value="60">1時間毎</SelectItem>
                    <SelectItem value="120">2時間毎</SelectItem>
                    <SelectItem value="180">3時間毎</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 時間範囲指定サマリ生成 */}
            <div className="mt-4 space-y-3 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <Label className="text-sm">時間範囲サマリ生成</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                指定した時間範囲のサマリを生成します (最大12時間)
              </p>
              <div className="flex items-center gap-2">
                <Select value={summaryStartHour} onValueChange={setSummaryStartHour}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={`start-${i}`} value={String(i)}>
                        {String(i).padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">〜</span>
                <Select value={summaryEndHour} onValueChange={setSummaryEndHour}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={`end-${i}`} value={String(i)}>
                        {String(i).padStart(2, "0")}:59
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleGenerateTimesSummary}
                  disabled={generatingSummary || summaryLoading}
                >
                  {generatingSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : "生成"}
                </Button>
              </div>
              {summaryError && <p className="text-xs text-destructive">{summaryError}</p>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
