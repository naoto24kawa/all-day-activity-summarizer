import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LogObject } from "consola";
import consola from "consola";

const LOG_DIR = join(homedir(), ".adas", "logs");

const LOG_LEVEL_LABELS: Record<number, string> = {
  0: "FATAL",
  1: "ERROR",
  2: "WARN",
  3: "INFO",
  4: "DEBUG",
  5: "TRACE",
};

export type LogSource = "serve" | "worker";

let currentSource: LogSource = "serve";
let initialized = false;

function formatLogLevel(level: number): string {
  return (LOG_LEVEL_LABELS[level] ?? "LOG").padEnd(5);
}

function getLogFilePath(source: LogSource): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return join(LOG_DIR, `${source}-${year}-${month}-${day}.log`);
}

/**
 * ファイルロガーをセットアップする
 * @param source - ログソース識別子 ("serve" | "worker")
 */
export function setupFileLogger(source: LogSource = "serve"): void {
  if (initialized) return;
  initialized = true;
  currentSource = source;

  mkdirSync(LOG_DIR, { recursive: true });

  consola.addReporter({
    log(logObj: LogObject) {
      const timestamp = new Date().toISOString();
      const level = formatLogLevel(logObj.level);
      const args = logObj.args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      const line = `${timestamp} ${level} ${args}\n`;
      try {
        appendFileSync(getLogFilePath(currentSource), line);
      } catch {
        // ログ書き込み失敗時はサイレントに無視(コンソール出力は継続)
      }
    },
  });
}

// ---------------------------------------------------------------------------
// ログ読み取り API
// ---------------------------------------------------------------------------

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

/**
 * ログディレクトリのパスを取得
 */
export function getLogDir(): string {
  return LOG_DIR;
}

/**
 * 利用可能なログファイル一覧を取得
 */
export function listLogFiles(): LogFileInfo[] {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const files = readdirSync(LOG_DIR, { withFileTypes: true });
    const logFiles: LogFileInfo[] = [];

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".log")) continue;

      // ファイル名パターン: {source}-{YYYY}-{MM}-{DD}.log または adas-{YYYY}-{MM}-{DD}.log (レガシー)
      const match = file.name.match(/^(serve|worker|adas)-(\d{4})-(\d{2})-(\d{2})\.log$/);
      if (!match) continue;

      const [, sourceOrLegacy, year, month, day] = match;
      const source: LogSource =
        sourceOrLegacy === "adas" ? "worker" : (sourceOrLegacy as LogSource);
      const date = `${year}-${month}-${day}`;

      const stats = Bun.file(join(LOG_DIR, file.name));
      logFiles.push({
        source,
        date,
        filename: file.name,
        size: stats.size,
      });
    }

    return logFiles.sort((a, b) => {
      // 日付降順、同日ならソース名でソート
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return a.source.localeCompare(b.source);
    });
  } catch {
    return [];
  }
}

/**
 * 指定されたログファイルの内容を読み取る
 */
export function readLogFile(
  source: LogSource,
  date: string,
  options?: { limit?: number; offset?: number },
): LogEntry[] {
  const limit = options?.limit ?? 500;
  const offset = options?.offset ?? 0;

  // レガシーファイル名もチェック
  const filenames =
    source === "worker" ? [`worker-${date}.log`, `adas-${date}.log`] : [`${source}-${date}.log`];

  let content = "";
  for (const filename of filenames) {
    try {
      content += readFileSync(join(LOG_DIR, filename), "utf-8");
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  if (!content) return [];

  const lines = content.trim().split("\n");
  const entries: LogEntry[] = [];

  for (const line of lines) {
    // パターン: 2026-01-29T12:34:56.789Z INFO  message
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(\w+)\s+(.*)$/);
    if (match) {
      entries.push({
        timestamp: match[1],
        level: match[2].trim(),
        message: match[3],
      });
    }
  }

  // タイムスタンプで新しい順にソートしてからページング
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries.slice(offset, offset + limit);
}
