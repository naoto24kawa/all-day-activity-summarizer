import { useCallback, useEffect, useState } from "react";
import { useAdasApi } from "./use-adas-api";

export type LogSource = "serve" | "worker";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface LogFileInfo {
  source: LogSource;
  date: string;
  filename: string;
  size: number;
}

export function useServerLogs(source: LogSource, date: string) {
  const { fetchApi } = useAdasApi();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ entries: LogEntry[] }>(
        `/api/server-logs/${source}/${date}?limit=500`,
      );
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [fetchApi, source, date]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { entries, loading, error, refetch: fetchLogs };
}

export function useLogFiles() {
  const { fetchApi } = useAdasApi();
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ files: LogFileInfo[] }>("/api/server-logs/files");
      setFiles(data.files);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  return { files, loading, refetch: fetchFiles };
}
