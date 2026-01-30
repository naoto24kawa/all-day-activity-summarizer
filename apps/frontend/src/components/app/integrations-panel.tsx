import { Github, MessageSquare, Mic, Plug, Sparkles, Terminal, Wand2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useConfig } from "@/hooks/use-config";

export function IntegrationsPanel() {
  const { integrations, loading, error, updating, updateIntegration } = useConfig();

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
      </CardContent>
    </Card>
  );
}
