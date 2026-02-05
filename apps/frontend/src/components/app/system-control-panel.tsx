/**
 * System Control Panel
 *
 * Server Launcher と Worker Launcher を GUI から操作
 * - Server Launcher: メインマシンで servers + frontend を管理
 * - Worker Launcher: Worker マシンで ai-worker + local-worker を管理
 */

import {
  AlertCircle,
  Check,
  Cloud,
  GitBranch,
  Loader2,
  Monitor,
  Power,
  RefreshCw,
  Server,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  type: "server" | "worker";
  processes: ProcessStatus[];
  isRestarting: boolean;
}

interface GitPullResult {
  success: boolean;
  output: string;
}

export function SystemControlPanel() {
  const { integrations, loading: configLoading } = useConfig();

  // Server Launcher state
  const [serverStatus, setServerStatus] = useState<LauncherStatus | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [restartingServer, setRestartingServer] = useState(false);
  const [serverGitPull, setServerGitPull] = useState<GitPullResult | null>(null);

  // Worker Launcher state
  const [workerStatus, setWorkerStatus] = useState<LauncherStatus | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [restartingWorker, setRestartingWorker] = useState(false);
  const [restartingProcess, setRestartingProcess] = useState<string | null>(null);
  const [workerGitPull, setWorkerGitPull] = useState<GitPullResult | null>(null);

  const serverLauncherUrl = integrations?.launcher?.url ?? "http://localhost:3999";
  const serverLauncherToken = integrations?.launcher?.token ?? "";

  const workerLauncherUrl = integrations?.workerLauncher?.url ?? "";
  const workerLauncherToken = integrations?.workerLauncher?.token ?? "";
  const hasWorkerLauncher = !!workerLauncherUrl && workerLauncherUrl !== "http://localhost:3998";

  const fetchLauncherStatus = useCallback(
    async (
      url: string,
      setStatus: (status: LauncherStatus | null) => void,
      setError: (error: string | null) => void,
    ) => {
      try {
        const res = await fetch(`${url}/status`, {
          signal: AbortSignal.timeout(5000),
        });
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
      }
    },
    [],
  );

  useEffect(() => {
    if (configLoading) return;

    // Server Launcher
    fetchLauncherStatus(serverLauncherUrl, setServerStatus, setServerError);

    // Worker Launcher
    if (hasWorkerLauncher) {
      fetchLauncherStatus(workerLauncherUrl, setWorkerStatus, setWorkerError);
    }

    const interval = setInterval(() => {
      fetchLauncherStatus(serverLauncherUrl, setServerStatus, setServerError);
      if (hasWorkerLauncher) {
        fetchLauncherStatus(workerLauncherUrl, setWorkerStatus, setWorkerError);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [configLoading, serverLauncherUrl, workerLauncherUrl, hasWorkerLauncher, fetchLauncherStatus]);

  const handleRestartLauncher = async (
    url: string,
    token: string,
    setRestarting: (v: boolean) => void,
    setGitPull: (result: GitPullResult | null) => void,
    setStatus: (status: LauncherStatus | null) => void,
    setError: (error: string | null) => void,
  ) => {
    setRestarting(true);
    setGitPull(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${url}/restart`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(60000),
      });

      if (res.status === 401) {
        setError("Unauthorized - check launcher token");
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as { gitPull: GitPullResult };
        setGitPull(data.gitPull);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await fetchLauncherStatus(url, setStatus, setError);
      } else {
        setError("Failed to restart");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setRestarting(false);
    }
  };

  const handleRestartProcess = async (processName: string) => {
    if (!hasWorkerLauncher) return;

    setRestartingProcess(processName);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (workerLauncherToken) {
        headers["Authorization"] = `Bearer ${workerLauncherToken}`;
      }

      const res = await fetch(`${workerLauncherUrl}/restart/${processName}`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await fetchLauncherStatus(workerLauncherUrl, setWorkerStatus, setWorkerError);
      }
    } catch {
      // エラーは無視
    } finally {
      setRestartingProcess(null);
    }
  };

  const isServerAvailable = !serverError && serverStatus !== null;
  const isWorkerAvailable = !workerError && workerStatus !== null;
  const allServerRunning = serverStatus?.processes.every((p) => p.running) ?? false;
  const allWorkerRunning = workerStatus?.processes.every((p) => p.running) ?? false;

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
      <CardContent className="space-y-6">
        {/* Server Launcher Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            <span className="font-medium">Server Launcher</span>
            {serverLauncherUrl !== "http://localhost:3999" && (
              <Badge variant="outline" className="text-xs">
                {new URL(serverLauncherUrl).host}
              </Badge>
            )}
          </div>

          {!isServerAvailable ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Server Launcher not running</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run <code className="rounded bg-muted px-1">bun run dev:server</code> to start.
                </p>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid gap-2">
                {serverStatus.processes.map((proc) => (
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

              <Button
                onClick={() =>
                  handleRestartLauncher(
                    serverLauncherUrl,
                    serverLauncherToken,
                    setRestartingServer,
                    setServerGitPull,
                    setServerStatus,
                    setServerError,
                  )
                }
                disabled={restartingServer || serverStatus.isRestarting}
                className="w-full"
                variant={allServerRunning ? "outline" : "default"}
                size="sm"
              >
                {restartingServer || serverStatus.isRestarting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Restarting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Restart Server
                  </>
                )}
              </Button>

              {serverGitPull && (
                <div
                  className={`rounded-md border p-2 text-xs ${serverGitPull.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                >
                  <div className="flex items-center gap-1 font-medium">
                    <GitBranch className="h-3 w-3" />
                    git pull {serverGitPull.success ? "成功" : "失敗"}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground">
                    {serverGitPull.output || "Already up to date"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Worker Launcher Section */}
        {hasWorkerLauncher && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              <span className="font-medium">Worker Launcher</span>
              <Badge variant="outline" className="text-xs">
                {new URL(workerLauncherUrl).host}
              </Badge>
            </div>

            {!isWorkerAvailable ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium">Worker Launcher not running</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Run <code className="rounded bg-muted px-1">bun run dev:worker</code> on the
                    worker machine.
                  </p>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="grid gap-2">
                  {workerStatus.processes.map((proc) => (
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRestartProcess(proc.name)}
                          disabled={restartingProcess === proc.name}
                        >
                          {restartingProcess === proc.name ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={() =>
                    handleRestartLauncher(
                      workerLauncherUrl,
                      workerLauncherToken,
                      setRestartingWorker,
                      setWorkerGitPull,
                      setWorkerStatus,
                      setWorkerError,
                    )
                  }
                  disabled={restartingWorker || workerStatus.isRestarting}
                  className="w-full"
                  variant={allWorkerRunning ? "outline" : "default"}
                  size="sm"
                >
                  {restartingWorker || workerStatus.isRestarting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Restarting...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Restart All Workers
                    </>
                  )}
                </Button>

                {workerGitPull && (
                  <div
                    className={`rounded-md border p-2 text-xs ${workerGitPull.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                  >
                    <div className="flex items-center gap-1 font-medium">
                      <GitBranch className="h-3 w-3" />
                      git pull {workerGitPull.success ? "成功" : "失敗"}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground">
                      {workerGitPull.output || "Already up to date"}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Help text */}
        <p className="text-center text-xs text-muted-foreground">
          {hasWorkerLauncher
            ? "git pull → 各 Launcher がプロセスを再起動"
            : "Worker Launcher を設定すると別マシンの Workers も管理可能"}
        </p>
      </CardContent>
    </Card>
  );
}
