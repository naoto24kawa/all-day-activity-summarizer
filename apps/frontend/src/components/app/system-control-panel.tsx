/**
 * System Control Panel
 *
 * サーバー/ワーカー/フロントエンドの一括再起動
 * リモートマシンからの再起動に対応 (config.json で URL/トークンを設定)
 */

import { AlertCircle, Check, GitBranch, Loader2, Power, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConfig } from "@/hooks/use-config";

interface ProcessStatus {
  name: string;
  pid: number;
  running: boolean;
}

interface LauncherStatus {
  processes: ProcessStatus[];
  isRestarting: boolean;
}

interface GitPullResult {
  success: boolean;
  output: string;
}

export function SystemControlPanel() {
  const { integrations, loading: configLoading } = useConfig();
  const [status, setStatus] = useState<LauncherStatus | null>(null);
  const [, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGitPull, setLastGitPull] = useState<GitPullResult | null>(null);

  const launcherUrl = integrations?.launcher?.url ?? "http://localhost:3999";
  const launcherToken = integrations?.launcher?.token ?? "";

  const fetchStatus = useCallback(async () => {
    if (!launcherUrl) return;

    try {
      const res = await fetch(`${launcherUrl}/status`);
      if (res.ok) {
        const data = (await res.json()) as LauncherStatus;
        setStatus(data);
        setError(null);
      } else {
        setError("Launcher not responding");
        setStatus(null);
      }
    } catch {
      setError("Launcher not running");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [launcherUrl]);

  useEffect(() => {
    if (configLoading) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, configLoading]);

  const handleRestart = async () => {
    setRestarting(true);
    setError(null);
    setLastGitPull(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (launcherToken) {
        headers["Authorization"] = `Bearer ${launcherToken}`;
      }

      const res = await fetch(`${launcherUrl}/restart`, {
        method: "POST",
        headers,
      });

      if (res.status === 401) {
        setError("Unauthorized - check launcher token in config");
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as { gitPull: GitPullResult };
        setLastGitPull(data.gitPull);
        // 再起動後にステータスを更新
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await fetchStatus();
      } else {
        setError("Failed to initiate restart");
      }
    } catch {
      setError("Failed to connect to launcher");
    } finally {
      setRestarting(false);
    }
  };

  const isLauncherAvailable = !error && status !== null;
  const allRunning = status?.processes.every((p) => p.running) ?? false;

  if (configLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            System Control
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          System Control
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Launcher Status */}
        {!isLauncherAvailable && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Dev Launcher not running</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run <code className="rounded bg-muted px-1">bun run dev:all</code> to start all
                services with restart support.
              </p>
              {launcherUrl !== "http://localhost:3999" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Target: <code className="rounded bg-muted px-1">{launcherUrl}</code>
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Process List */}
        {isLauncherAvailable && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Processes</span>
              {launcherUrl !== "http://localhost:3999" && (
                <span className="text-xs text-muted-foreground">{launcherUrl}</span>
              )}
            </div>
            <div className="grid gap-2">
              {status.processes.map((proc) => (
                <div
                  key={proc.name}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm font-medium">{proc.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">PID: {proc.pid}</span>
                    {proc.running ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <Check className="h-4 w-4 text-green-500" />
                        </TooltipTrigger>
                        <TooltipContent>Running</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger>
                          <Power className="h-4 w-4 text-red-500" />
                        </TooltipTrigger>
                        <TooltipContent>Stopped</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Restart Button */}
        <Button
          onClick={handleRestart}
          disabled={!isLauncherAvailable || restarting || status?.isRestarting}
          className="w-full"
          variant={allRunning ? "outline" : "default"}
        >
          {restarting || status?.isRestarting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Restarting...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Restart All Services
            </>
          )}
        </Button>

        {/* Git Pull Result */}
        {lastGitPull && (
          <div
            className={`rounded-md border p-3 ${lastGitPull.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="h-4 w-4" />
              git pull {lastGitPull.success ? "成功" : "失敗"}
            </div>
            <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {lastGitPull.output || "Already up to date"}
            </p>
          </div>
        )}

        {error && isLauncherAvailable && (
          <p className="text-center text-sm text-destructive">{error}</p>
        )}

        <p className="text-center text-xs text-muted-foreground">
          git pull → Servers, AI Worker, Local Worker, Frontend を一括再起動
        </p>
      </CardContent>
    </Card>
  );
}
