/**
 * Claude History Reader
 *
 * Claude Code のローカル履歴ファイルを読み取る
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { decodeProjectPath, encodeProjectPath } from "./path-decoder.js";
import type {
  GetHistoryOptions,
  GlobalHistoryEntry,
  HistoryResult,
  ProjectInfo,
  SessionDetail,
  SessionInfo,
  SessionMessage,
  SessionSummary,
} from "./types.js";

/**
 * Claude ディレクトリのパスを取得
 */
export function getClaudeDir(): string {
  return path.join(homedir(), ".claude");
}

/**
 * プロジェクトディレクトリのパスを取得
 */
export function getProjectsDir(): string {
  return path.join(getClaudeDir(), "projects");
}

/**
 * グローバル履歴ファイルのパスを取得
 */
export function getGlobalHistoryPath(): string {
  return path.join(getClaudeDir(), "history.jsonl");
}

/**
 * JSONL ファイルを読み取る
 */
async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * プロジェクト一覧を取得
 */
export async function listProjects(): Promise<ProjectInfo[]> {
  const projectsDir = getProjectsDir();

  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("-")) {
        const projectDir = path.join(projectsDir, entry.name);
        const files = await fs.readdir(projectDir);
        const sessionFiles = files.filter((f) => f.endsWith(".jsonl"));

        const decodedPath = decodeProjectPath(entry.name);

        projects.push({
          name: path.basename(decodedPath),
          path: decodedPath,
          encodedPath: entry.name,
          sessionCount: sessionFiles.length,
        });
      }
    }

    return projects;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * プロジェクトのセッション一覧を取得
 */
export async function listSessions(projectPath: string): Promise<SessionInfo[]> {
  const encodedPath = encodeProjectPath(projectPath);
  const projectDir = path.join(getProjectsDir(), encodedPath);

  try {
    const files = await fs.readdir(projectDir);
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        const sessionId = file.replace(".jsonl", "");

        sessions.push({
          id: sessionId,
          projectPath,
          filePath,
          modifiedAt: stats.mtime,
        });
      }
    }

    // 更新日時で降順ソート
    return sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

// 内部型定義
interface SessionHistoryEntry {
  type: "user" | "assistant" | "system";
  timestamp?: string;
  message?: {
    content?: MessageContent | MessageContent[];
  };
}

interface MessageContentToolUse {
  type: "tool_use";
  name: string;
}

interface MessageContentText {
  type: "text";
  text: string;
}

type MessageContent = string | MessageContentToolUse | MessageContentText;

/**
 * メッセージコンテンツからテキストを抽出
 */
function extractTextFromContent(content: MessageContent | MessageContent[] | undefined): string {
  if (!content) return "";

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c.type === "text") return c.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content.type === "text") {
    return content.text;
  }

  return "";
}

/**
 * セッション詳細を取得
 */
export async function getSessionDetail(
  projectPath: string,
  sessionId: string,
): Promise<SessionDetail | null> {
  const encodedPath = encodeProjectPath(projectPath);
  const sessionFile = path.join(getProjectsDir(), encodedPath, `${sessionId}.jsonl`);

  try {
    const entries = await readJsonlFile<SessionHistoryEntry>(sessionFile);

    // メッセージのみをフィルタリング
    const messageEntries = entries.filter((e) => e.type === "user" || e.type === "assistant");

    // サマリーを計算
    const summary: SessionSummary = {
      userMessageCount: 0,
      assistantMessageCount: 0,
      toolUseCount: 0,
      startTime: null,
      endTime: null,
    };

    const messages: SessionMessage[] = [];

    for (const entry of messageEntries) {
      const text = extractTextFromContent(entry.message?.content);

      if (entry.type === "user") {
        summary.userMessageCount++;
        messages.push({
          role: "user",
          text,
          timestamp: entry.timestamp,
        });
      } else if (entry.type === "assistant") {
        summary.assistantMessageCount++;
        messages.push({
          role: "assistant",
          text,
          timestamp: entry.timestamp,
        });

        // tool_use をカウント
        const content = entry.message?.content;
        if (content) {
          const contents = Array.isArray(content) ? content : [content];
          for (const c of contents) {
            if (
              typeof c === "object" &&
              c !== null &&
              (c as MessageContentToolUse).type === "tool_use"
            ) {
              summary.toolUseCount++;
            }
          }
        }
      }

      // 時間範囲
      if (entry.timestamp) {
        if (!summary.startTime || entry.timestamp < summary.startTime) {
          summary.startTime = entry.timestamp;
        }
        if (!summary.endTime || entry.timestamp > summary.endTime) {
          summary.endTime = entry.timestamp;
        }
      }
    }

    return {
      sessionId,
      projectPath,
      summary,
      messages,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * グローバル履歴を取得
 */
export async function getHistory(options: GetHistoryOptions = {}): Promise<HistoryResult> {
  const historyPath = getGlobalHistoryPath();
  const entries = await readJsonlFile<GlobalHistoryEntry>(historyPath);

  let filtered = entries;

  // 日付フィルタリング
  if (options.startDate) {
    const startTs = options.startDate.getTime();
    filtered = filtered.filter((e) => e.timestamp >= startTs);
  }

  if (options.endDate) {
    const endTs = options.endDate.getTime();
    filtered = filtered.filter((e) => e.timestamp <= endTs);
  }

  // プロジェクトフィルタリング
  if (options.project) {
    filtered = filtered.filter((e) => e.project === options.project);
  }

  // 新しい順にソート
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const totalCount = filtered.length;

  // 件数制限
  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return {
    entries: filtered,
    totalCount,
  };
}
