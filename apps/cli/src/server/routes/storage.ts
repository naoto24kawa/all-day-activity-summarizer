import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StorageFolderMetrics, StorageMetrics } from "@repo/types";
import { Hono } from "hono";
import type { AdasConfig } from "../../config.js";
import { getAdasHome } from "../../config.js";

/**
 * バイト数を人間が読みやすい形式にフォーマット
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / k ** i;
  return `${value.toFixed(2)} ${sizes[i]}`;
}

/**
 * ディレクトリのサイズとファイル数を計算
 */
function getDirectoryStats(dirPath: string): { bytes: number; fileCount: number } {
  if (!existsSync(dirPath)) {
    return { bytes: 0, fileCount: 0 };
  }

  let totalBytes = 0;
  let fileCount = 0;

  function walkDir(currentPath: string) {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const stats = statSync(fullPath);
        totalBytes += stats.size;
        fileCount++;
      }
    }
  }

  walkDir(dirPath);
  return { bytes: totalBytes, fileCount };
}

/**
 * ファイルのサイズを取得
 */
function getFileSize(filePath: string): number {
  if (!existsSync(filePath)) {
    return 0;
  }
  return statSync(filePath).size;
}

/**
 * 録音フォルダの日付別内訳を取得
 */
function getRecordingsByDate(recordingsDir: string): Record<string, StorageFolderMetrics> {
  const byDate: Record<string, StorageFolderMetrics> = {};

  if (!existsSync(recordingsDir)) {
    return byDate;
  }

  const entries = readdirSync(recordingsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
      const datePath = join(recordingsDir, entry.name);
      const stats = getDirectoryStats(datePath);
      byDate[entry.name] = {
        bytes: stats.bytes,
        formatted: formatBytes(stats.bytes),
        fileCount: stats.fileCount,
      };
    }
  }

  return byDate;
}

export function createStorageRouter(config: AdasConfig) {
  const router = new Hono();
  const adasHome = getAdasHome();

  router.get("/", (c) => {
    // Recordings
    const recordingsStats = getDirectoryStats(config.recordingsDir);
    const recordingsByDate = getRecordingsByDate(config.recordingsDir);

    // Database (main + WAL + SHM)
    const dbSize = getFileSize(config.dbPath);
    const walSize = getFileSize(`${config.dbPath}-wal`);
    const shmSize = getFileSize(`${config.dbPath}-shm`);
    const totalDbSize = dbSize + walSize + shmSize;

    // Logs
    const logsDir = join(adasHome, "logs");
    const logsStats = getDirectoryStats(logsDir);

    // Total
    const totalBytes = recordingsStats.bytes + totalDbSize + logsStats.bytes;

    const metrics: StorageMetrics = {
      recordings: {
        bytes: recordingsStats.bytes,
        formatted: formatBytes(recordingsStats.bytes),
        fileCount: recordingsStats.fileCount,
        byDate: recordingsByDate,
      },
      database: {
        bytes: totalDbSize,
        formatted: formatBytes(totalDbSize),
        fileCount: 1 + (walSize > 0 ? 1 : 0) + (shmSize > 0 ? 1 : 0),
      },
      logs: {
        bytes: logsStats.bytes,
        formatted: formatBytes(logsStats.bytes),
        fileCount: logsStats.fileCount,
      },
      total: {
        bytes: totalBytes,
        formatted: formatBytes(totalBytes),
      },
    };

    return c.json(metrics);
  });

  return router;
}
