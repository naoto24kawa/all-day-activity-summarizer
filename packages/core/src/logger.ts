import { appendFileSync, mkdirSync } from "node:fs";
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

function formatLogLevel(level: number): string {
  return (LOG_LEVEL_LABELS[level] ?? "LOG").padEnd(5);
}

function getLogFilePath(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return join(LOG_DIR, `adas-${year}-${month}-${day}.log`);
}

let initialized = false;

export function setupFileLogger(): void {
  if (initialized) return;
  initialized = true;

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
        appendFileSync(getLogFilePath(), line);
      } catch {
        // ログ書き込み失敗時はサイレントに無視(コンソール出力は継続)
      }
    },
  });
}
