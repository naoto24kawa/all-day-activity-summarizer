/**
 * System Control Panel
 *
 * servers と workers の状態表示・再起動
 * - servers: cli servers (API + SSE + Launcher on 3999)
 * - workers: cli workers (ai-worker + local-worker + Launcher on 3998)
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

interface RestartResult {
  gitCheckout?: { success: boolean; output: string };
  gitPull: { success: boolean; output: string };
  bunInstall?: { success: boolean; output: string };
}

export function SystemControlPanel() {
  const { integrations, loading: configLoading } = useConfig();

  // Server Launcher state (port 3999)
  const [serverStatus, setServerStatus] = useState<LauncherStatus | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [restartingServer, setRestartingServer] = useState(false);
  const [serverRestartResult, setServerRestartResult] = useState<RestartResult | null>(null);

  // Worker Launcher state (port 3998)
  const [workerStatus, setWorkerStatus] = useState<LauncherStatus | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [restartingWorker, setRestartingWorker] = useState(false);
  const [restartingProcess, setRestartingProcess] = useState<string | null>(null);
  const [workerRestartResult, setWorkerRestartResult] = useState<RestartResult | null>(null);

  const serverLauncherUrl = integrations?.launcher?.url ?? "http://localhost:3999";
  const serverLauncherToken = integrations?.launcher?.token ?? "";

  const workerLauncherUrl = integrations?.workerLauncher?.url ?? "http://localhost:3998";
  const workerLauncherToken = integrations?.workerLauncher?.token ?? "";

  // Worker Launcher が別マシンかどうか
  const isWorkerRemote =
    workerLauncherUrl !== "http://localhost:3998" && !workerLauncherUrl.includes("localhost");

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
          setError("Not responding");
          setStatus(null);
        }
      } catch {
        setError("Not running");
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
    fetchLauncherStatus(workerLauncherUrl, setWorkerStatus, setWorkerError);

    const interval = setInterval(() => {
      fetchLauncherStatus(serverLauncherUrl, setServerStatus, setServerError);
      fetchLauncherStatus(workerLauncherUrl, setWorkerStatus, setWorkerError);
    }, 5000);

    return () => clearInterval(interval);
  }, [configLoading, serverLauncherUrl, workerLauncherUrl, fetchLauncherStatus]);

  const handleRestartServers = async () => {
    setRestartingServer(true);
    setServerRestartResult(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (serverLauncherToken) {
        headers["Authorization"] = `Bearer ${serverLauncherToken}`;
      }

      const res = await fetch(`${serverLauncherUrl}/restart`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(120000),
      });

      if (res.status === 401) {
        setServerError("Unauthorized - check token");
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as RestartResult;
        setServerRestartResult(data);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await fetchLauncherStatus(serverLauncherUrl, setServerStatus, setServerError);
      } else {
        setServerError("Failed to restart");
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setRestartingServer(false);
    }
  };

  const handleRestartWorkers = async () => {
    setRestartingWorker(true);
    setWorkerRestartResult(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (workerLauncherToken) {
        headers["Authorization"] = `Bearer ${workerLauncherToken}`;
      }

      const res = await fetch(`${workerLauncherUrl}/restart`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(120000),
      });

      if (res.status === 401) {
        setWorkerError("Unauthorized - check token");
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as RestartResult;
        setWorkerRestartResult(data);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await fetchLauncherStatus(workerLauncherUrl, setWorkerStatus, setWorkerError);
      } else {
        setWorkerError("Failed to restart");
      }
    } catch (err) {
      setWorkerError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setRestartingWorker(false);
    }
  };

  const handleRestartProcess = async (processName: string) => {
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
        {/* Server Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            <span className="font-medium">Servers</span>
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
                <p className="font-medium">Servers not running</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run <code className="rounded bg-muted px-1">bun run cli servers</code> to start.
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
                onClick={handleRestartServers}
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
                    Restart Servers
                  </>
                )}
              </Button>

              {serverRestartResult && (
                <div className="space-y-2">
                  {/* git checkout */}
                  {serverRestartResult.gitCheckout && (
                    <div
                      className={`rounded-md border p-2 text-xs ${serverRestartResult.gitCheckout.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                    >
                      <div className="flex items-center gap-1 font-medium">
                        <GitBranch className="h-3 w-3" />
                        git checkout . {serverRestartResult.gitCheckout.success ? "成功" : "失敗"}
                      </div>
                      {serverRestartResult.gitCheckout.output && (
                        <p className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground">
                          {serverRestartResult.gitCheckout.output}
                        </p>
                      )}
                    </div>
                  )}

                  {/* git pull */}
                  <div
                    className={`rounded-md border p-2 text-xs ${serverRestartResult.gitPull.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                  >
                    <div className="flex items-center gap-1 font-medium">
                      <GitBranch className="h-3 w-3" />
                      git pull {serverRestartResult.gitPull.success ? "成功" : "失敗"}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground">
                      {serverRestartResult.gitPull.output || "Already up to date"}
                    </p>
                  </div>

                  {/* bun install */}
                  {serverRestartResult.bunInstall && (
                    <div
                      className={`rounded-md border p-2 text-xs ${serverRestartResult.bunInstall.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                    >
                      <div className="flex items-center gap-1 font-medium">
                        <GitBranch className="h-3 w-3" />
                        bun install {serverRestartResult.bunInstall.success ? "成功" : "失敗"}
                      </div>
                      {serverRestartResult.bunInstall.output && (
                        <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-muted-foreground">
                          {serverRestartResult.bunInstall.output}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Worker Section */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2">
            {isWorkerRemote ? <Cloud className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
            <span className="font-medium">Workers</span>
            {isWorkerRemote && (
              <Badge variant="outline" className="text-xs">
                {new URL(workerLauncherUrl).host}
              </Badge>
            )}
          </div>

          {!isWorkerAvailable ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Workers not running</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run <code className="rounded bg-muted px-1">bun run cli workers</code>
                  {isWorkerRemote && " on the worker machine"}.
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
                onClick={handleRestartWorkers}
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

              {workerRestartResult && (
                <div className="space-y-2">
                  {/* git checkout */}
                  {workerRestartResult.gitCheckout && (
                    <div
                      className={`rounded-md border p-2 text-xs ${workerRestartResult.gitCheckout.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                    >
                      <div className="flex items-center gap-1 font-medium">
                        <GitBranch className="h-3 w-3" />
                        git checkout . {workerRestartResult.gitCheckout.success ? "成功" : "失敗"}
                      </div>
                      {workerRestartResult.gitCheckout.output && (
                        <p className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground">
                          {workerRestartResult.gitCheckout.output}
                        </p>
                      )}
                    </div>
                  )}

                  {/* git pull */}
                  <div
                    className={`rounded-md border p-2 text-xs ${workerRestartResult.gitPull.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                  >
                    <div className="flex items-center gap-1 font-medium">
                      <GitBranch className="h-3 w-3" />
                      git pull {workerRestartResult.gitPull.success ? "成功" : "失敗"}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground">
                      {workerRestartResult.gitPull.output || "Already up to date"}
                    </p>
                  </div>

                  {/* bun install */}
                  {workerRestartResult.bunInstall && (
                    <div
                      className={`rounded-md border p-2 text-xs ${workerRestartResult.bunInstall.success ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                    >
                      <div className="flex items-center gap-1 font-medium">
                        <GitBranch className="h-3 w-3" />
                        bun install {workerRestartResult.bunInstall.success ? "成功" : "失敗"}
                      </div>
                      {workerRestartResult.bunInstall.output && (
                        <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-muted-foreground">
                          {workerRestartResult.bunInstall.output}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Help text */}
        <p className="text-center text-xs text-muted-foreground">
          Restart: git checkout . → git pull → bun i → 再起動
        </p>
      </CardContent>
    </Card>
  );
}
