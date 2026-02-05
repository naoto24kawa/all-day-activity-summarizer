/**
 * Claude History Types
 */

export interface ProjectInfo {
  /** プロジェクト名 (ディレクトリ名) */
  name: string;
  /** 実際のファイルシステムパス */
  path: string;
  /** エンコードされたパス (Claude が使用する形式) */
  encodedPath: string;
  /** セッション数 */
  sessionCount: number;
}

export interface SessionInfo {
  /** セッション ID (UUID) */
  id: string;
  /** プロジェクトパス */
  projectPath: string;
  /** セッションファイルのパス */
  filePath: string;
  /** 最終更新日時 */
  modifiedAt: Date;
}

export interface SessionSummary {
  /** ユーザーメッセージ数 */
  userMessageCount: number;
  /** アシスタントメッセージ数 */
  assistantMessageCount: number;
  /** ツール使用回数 */
  toolUseCount: number;
  /** 開始時刻 */
  startTime: string | null;
  /** 終了時刻 */
  endTime: string | null;
}

export interface SessionMessage {
  /** メッセージの役割 */
  role: "user" | "assistant";
  /** メッセージ本文 */
  text: string;
  /** タイムスタンプ */
  timestamp?: string;
}

export interface SessionDetail {
  /** セッション ID */
  sessionId: string;
  /** プロジェクトパス */
  projectPath: string;
  /** サマリー情報 */
  summary: SessionSummary;
  /** メッセージ一覧 */
  messages: SessionMessage[];
}

export interface GlobalHistoryEntry {
  /** タイムスタンプ (Unix ms) */
  timestamp: number;
  /** プロジェクトパス */
  project: string;
  /** セッション ID */
  sessionId: string;
  /** プロンプト */
  prompt?: string;
}

export interface GetHistoryOptions {
  /** 開始日 */
  startDate?: Date;
  /** 終了日 */
  endDate?: Date;
  /** プロジェクトパスでフィルタ */
  project?: string;
  /** 取得件数上限 */
  limit?: number;
}

export interface HistoryResult {
  /** エントリ一覧 */
  entries: GlobalHistoryEntry[];
  /** 総件数 */
  totalCount: number;
}
