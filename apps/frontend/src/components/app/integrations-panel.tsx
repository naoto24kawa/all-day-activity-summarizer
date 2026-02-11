/**
 * Integrations Panel
 *
 * 外部サービス連携の有効/無効を管理
 */

import {
  AlertTriangle,
  Calendar,
  FileText,
  Github,
  Info,
  MessageSquare,
  Mic,
  Plug,
  Plus,
  Sparkles,
  Terminal,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConfig } from "@/hooks/use-config";

export function IntegrationsPanel() {
  const {
    integrations,
    loading,
    error,
    updating,
    updateIntegration,
    updateSlackKeywords,
    updateAiProcessingLogExtractConfig,
  } = useConfig();
  const [newKeyword, setNewKeyword] = useState("");

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
    integration:
      | "whisper"
      | "slack"
      | "github"
      | "calendar"
      | "notion"
      | "claudeCode"
      | "evaluator"
      | "promptImprovement"
      | "aiProcessingLogExtract",
    enabled: boolean,
  ) => {
    try {
      const result = await updateIntegration(integration, enabled);
      if (result.requiresRestart) {
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p>外部サービス連携の有効/無効を切り替えます。</p>
              <p>変更後はサーバーの再起動が必要です。</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
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
        <div className="space-y-3">
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

          {/* キーワード監視設定 */}
          {integrations.slack.hasCredentials && integrations.slack.enabled && (
            <div className="ml-6 space-y-2 border-l-2 border-muted pl-4">
              <Label className="text-sm text-muted-foreground">監視キーワード</Label>
              <div className="flex flex-wrap gap-2">
                {integrations.slack.watchKeywords.map((keyword) => (
                  <Badge
                    key={keyword}
                    variant="secondary"
                    className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => {
                      const updated = integrations.slack.watchKeywords.filter((k) => k !== keyword);
                      updateSlackKeywords({ watchKeywords: updated });
                    }}
                  >
                    {keyword} ×
                  </Badge>
                ))}
                <div className="flex gap-1">
                  <Input
                    placeholder="追加..."
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newKeyword.trim()) {
                        if (!integrations.slack.watchKeywords.includes(newKeyword.trim())) {
                          updateSlackKeywords({
                            watchKeywords: [...integrations.slack.watchKeywords, newKeyword.trim()],
                          });
                        }
                        setNewKeyword("");
                      }
                    }}
                    className="h-6 w-24 text-xs"
                    disabled={updating}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={() => {
                      if (
                        newKeyword.trim() &&
                        !integrations.slack.watchKeywords.includes(newKeyword.trim())
                      ) {
                        updateSlackKeywords({
                          watchKeywords: [...integrations.slack.watchKeywords, newKeyword.trim()],
                        });
                        setNewKeyword("");
                      }
                    }}
                    disabled={updating || !newKeyword.trim()}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="mt-2">
                <Label className="text-sm text-muted-foreground">キーワード優先度</Label>
                <Select
                  value={integrations.slack.keywordPriority ?? "medium"}
                  onValueChange={(value: "high" | "medium" | "low") => {
                    updateSlackKeywords({ keywordPriority: value });
                  }}
                  disabled={updating}
                >
                  <SelectTrigger className="mt-1 h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
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

        {/* Google Calendar */}
        {integrations.calendar && (
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="calendar-toggle" className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Google Calendar
              </Label>
              <p className="text-sm text-muted-foreground">
                {integrations.calendar.hasCredentials
                  ? `カレンダーイベント取得 (${integrations.calendar.fetchIntervalMinutes}分間隔)`
                  : "credentials.json を ~/.adas/ に配置してください"}
              </p>
            </div>
            <Switch
              id="calendar-toggle"
              checked={integrations.calendar.enabled}
              onCheckedChange={(checked) => handleToggle("calendar", checked)}
              disabled={updating || !integrations.calendar.hasCredentials}
            />
          </div>
        )}

        {/* Notion */}
        {integrations.notion && (
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="notion-toggle" className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Notion
              </Label>
              <p className="text-sm text-muted-foreground">
                {integrations.notion.hasToken
                  ? `データベース監視 (${integrations.notion.databaseIds.length} databases)`
                  : "config.json で token を設定してください"}
              </p>
            </div>
            <Switch
              id="notion-toggle"
              checked={integrations.notion.enabled}
              onCheckedChange={(checked) => handleToggle("notion", checked)}
              disabled={updating || !integrations.notion.hasToken}
            />
          </div>
        )}

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

        {/* AI Processing Log Extract */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="ailog-toggle" className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" />
                AI Processing Log Extract
              </Label>
              <p className="text-sm text-muted-foreground">AI 処理エラーからタスク自動抽出</p>
            </div>
            <Switch
              id="ailog-toggle"
              checked={integrations.aiProcessingLogExtract.enabled}
              onCheckedChange={(checked) => handleToggle("aiProcessingLogExtract", checked)}
              disabled={updating}
            />
          </div>

          {/* 間隔設定 */}
          {integrations.aiProcessingLogExtract.enabled && (
            <div className="ml-6 space-y-2 border-l-2 border-muted pl-4">
              <Label className="text-sm text-muted-foreground">抽出間隔 (分)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={integrations.aiProcessingLogExtract.intervalMinutes}
                  onChange={(e) => {
                    const value = Math.max(0, Math.min(1440, Number(e.target.value) || 0));
                    updateAiProcessingLogExtractConfig({ intervalMinutes: value });
                  }}
                  className="h-8 w-20"
                  disabled={updating}
                />
                <span className="text-xs text-muted-foreground">(0 = 無効)</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
