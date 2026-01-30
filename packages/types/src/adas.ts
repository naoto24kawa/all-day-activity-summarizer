/** 文字起こしセグメント */
export interface TranscriptionSegment {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  audioSource: string;
  audioFilePath: string;
  transcription: string;
  language: string;
  confidence: number | null;
  speaker: string | null;
  interpretedText: string | null;
  createdAt: string;
}

/** 要約 */
export interface Summary {
  id: number;
  date: string;
  periodStart: string;
  periodEnd: string;
  summaryType: "pomodoro" | "hourly" | "daily";
  content: string;
  segmentIds: string;
  model: string;
  createdAt: string;
}

/** メモ */
export interface Memo {
  id: number;
  date: string;
  content: string;
  tags: string | null; // JSON array: ["TODO", "重要"]
  createdAt: string;
}

/** メモタグ定数 */
export const MEMO_TAGS = [
  "完了",
  "重要",
  "TODO",
  "要確認",
  "後で",
  "アイデア",
  "問題",
  "メモ",
] as const;

/** メモタグ型 */
export type MemoTag = (typeof MEMO_TAGS)[number];

/** 録音状態レスポンス */
export interface RecordingStatusResponse {
  mic: boolean | null;
  speaker: boolean | null;
}

/** 個別ソース録音制御レスポンス */
export interface RecordingSourceResponse {
  recording: boolean;
}

/** ステータスレスポンス */
export interface StatusResponse {
  date: string;
  transcriptionSegments: number;
  summaries: number;
  latestTranscriptionTime: string | null;
  uptime: number;
}

/** 要約生成リクエスト */
export interface GenerateSummaryRequest {
  date?: string;
  type?: "pomodoro" | "hourly" | "daily";
  hour?: number;
}

/** Evaluator ログ */
export interface EvaluatorLog {
  id: number;
  date: string;
  audioFilePath: string;
  transcriptionText: string;
  judgment: "hallucination" | "legitimate" | "mixed";
  confidence: number;
  reason: string;
  suggestedPattern: string | null;
  patternApplied: boolean;
  createdAt: string;
}

/** 要約生成レスポンス */
export interface GenerateSummaryResponse {
  success: boolean;
  content?: string | null;
  hourlyCount?: number;
  dailyGenerated?: boolean;
}

// ========== RPC 型定義 ==========

/** RPC Transcribe リクエスト(multipart/form-data で送信) */
export interface RpcTranscribeConfig {
  language: string;
  engine: "whisperx" | "whisper-cpp";
  initialPrompt?: string;
}

/** RPC Transcribe レスポンス */
export interface RpcTranscribeResponse {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language: string;
}

/** RPC Summarize リクエスト */
export interface RpcSummarizeRequest {
  prompt: string;
  model: string;
}

/** RPC Summarize レスポンス */
export interface RpcSummarizeResponse {
  content: string;
}

/** RPC Evaluate リクエスト */
export interface RpcEvaluateRequest {
  text: string;
  segments: Array<{ text: string; start: number; end: number }>;
}

/** セグメント単位の評価結果 */
export interface SegmentEvaluation {
  index: number;
  judgment: "hallucination" | "legitimate";
  confidence: number;
  reason: string;
  suggestedPattern: string | null;
}

/** RPC Evaluate レスポンス */
export interface RpcEvaluateResponse {
  /** 全体の判定 (後方互換性のため維持) */
  judgment: "hallucination" | "legitimate" | "mixed";
  confidence: number;
  reason: string;
  suggestedPattern: string | null;
  /** セグメント単位の判定結果 */
  segmentEvaluations?: SegmentEvaluation[];
}

/** RPC Interpret リクエスト */
export interface RpcInterpretRequest {
  text: string;
  speaker?: string;
  context?: string;
}

/** RPC Interpret レスポンス */
export interface RpcInterpretResponse {
  interpretedText: string;
}

/** プロンプト改善ターゲット */
export type PromptTarget =
  | "interpret"
  | "evaluate"
  | "summarize-hourly"
  | "summarize-daily"
  | "task-extract";

/** セグメントフィードバック (interpret 用) */
export interface SegmentFeedback {
  id: number;
  segmentId: number;
  rating: "good" | "bad";
  target: PromptTarget;
  reason: string | null;
  issues: string | null; // JSON array of issue types
  correctedText: string | null;
  createdAt: string;
}

/** セグメントフィードバック作成レスポンス */
export interface SegmentFeedbackResponse extends SegmentFeedback {
  /** 抽出された用語候補 (vocabulary 未登録のもの) */
  suggestedTerms: string[];
}

/** interpret フィードバックの問題点タイプ */
export type InterpretIssueType =
  | "meaning_changed" // 意味が変わった
  | "info_lost" // 情報が消えた
  | "wrong_conversion" // 誤変換
  | "filler_remaining"; // フィラー残り

/** フィードバックターゲットタイプ */
export type FeedbackTargetType = "summary" | "evaluator_log";

/** フィードバック評価 */
export type FeedbackRating = "good" | "neutral" | "bad";

/** サマリーフィードバックの問題点タイプ */
export type SummaryIssueType =
  | "info_missing" // 情報不足
  | "too_verbose" // 冗長
  | "incorrect" // 誤り
  | "bad_structure"; // 構成が悪い

/** Evaluator 判定タイプ */
export type EvaluatorJudgment = "hallucination" | "legitimate" | "mixed";

/** 汎用フィードバック (summary, evaluator_log 用) */
export interface Feedback {
  id: number;
  targetType: FeedbackTargetType;
  targetId: number;
  rating: FeedbackRating;
  issues: string | null; // JSON array of issue types
  reason: string | null;
  correctedText: string | null;
  correctJudgment: EvaluatorJudgment | null;
  createdAt: string;
}

/** プロンプト改善履歴 */
export interface PromptImprovement {
  id: number;
  target: PromptTarget;
  previousPrompt: string;
  newPrompt: string;
  feedbackCount: number;
  goodCount: number;
  badCount: number;
  improvementReason: string | null;
  createdAt: string;
}

/** RPC Health レスポンス */
export interface RpcHealthResponse {
  status: "ok";
  whisperx: boolean;
  claude: boolean;
}

// ========== Browser Recording 型定義 ==========

/** ブラウザ録音チャンクのメタデータ */
export interface BrowserRecordingChunkMetadata {
  /** 録音開始時刻 (ISO8601) */
  startTime: string;
  /** 録音終了時刻 (ISO8601) */
  endTime: string;
  /** 音声ソース種別 */
  audioSource: "mic" | "system";
  /** 日付 (YYYY-MM-DD) */
  date: string;
}

/** ブラウザ録音チャンクのレスポンス */
export interface BrowserRecordingChunkResponse {
  success: boolean;
  error?: string;
}

/** ブラウザ録音状態 */
export interface BrowserRecordingStatus {
  /** マイク録音中 */
  micRecording: boolean;
  /** システム音声録音中 */
  systemRecording: boolean;
  /** 最後のチャンク送信時刻 (ISO8601) */
  lastChunkTime?: string;
  /** 録音開始時刻 (ISO8601) */
  startedAt?: string;
}

// ========== Slack 型定義 ==========

/** Slack メッセージ */
export interface SlackMessage {
  id: number;
  date: string;
  messageTs: string;
  channelId: string;
  channelName: string | null;
  userId: string;
  userName: string | null;
  messageType: "mention" | "channel" | "dm";
  text: string;
  threadTs: string | null;
  permalink: string | null;
  isRead: boolean;
  createdAt: string;
}

// ========== Claude Code 型定義 ==========

/** Claude Code セッション */
export interface ClaudeCodeSession {
  id: number;
  date: string;
  sessionId: string;
  projectPath: string;
  projectName: string | null;
  startTime: string | null;
  endTime: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  toolUseCount: number;
  summary: string | null;
  createdAt: string;
}

/** Claude Code メッセージ */
export interface ClaudeCodeMessage {
  id: number;
  sessionId: string;
  date: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string | null;
  createdAt: string;
}

/** 学びソース種別 */
export type LearningSourceType =
  | "claude-code"
  | "transcription"
  | "github-comment"
  | "slack-message";

/** 学び (各種ソースから抽出) */
export interface Learning {
  id: number;
  sourceType: LearningSourceType;
  sourceId: string;
  projectId: number | null;
  date: string;
  content: string;
  category: string | null;
  tags: string | null; // JSON array
  confidence: number | null;

  // 間隔反復学習用 (SM-2)
  repetitionCount: number;
  easeFactor: number;
  interval: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;

  createdAt: string;
}

/** 学びカテゴリ */
export type LearningCategory =
  | "typescript"
  | "react"
  | "architecture"
  | "testing"
  | "devops"
  | "database"
  | "api"
  | "security"
  | "performance"
  | "communication"
  | "other";

// ========== GitHub 型定義 ==========

/** GitHub Item (Issue/PR) */
export interface GitHubItem {
  id: number;
  date: string;
  itemType: "issue" | "pull_request";
  repoOwner: string;
  repoName: string;
  number: number;
  title: string;
  state: string;
  url: string;
  authorLogin: string | null;
  assigneeLogin: string | null;
  labels: string | null;
  body: string | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
  isDraft: boolean | null;
  reviewDecision: string | null;
  isReviewRequested: boolean | null;
  commentCount: number | null;
  isRead: boolean | null;
  syncedAt: string;
}

/** GitHub Comment */
export interface GitHubComment {
  id: number;
  date: string;
  commentType: "issue_comment" | "review_comment" | "review";
  repoOwner: string;
  repoName: string;
  itemNumber: number;
  commentId: string;
  authorLogin: string | null;
  body: string;
  url: string;
  reviewState: string | null;
  githubCreatedAt: string | null;
  isRead: boolean | null;
  syncedAt: string;
}

/** GitHub unread counts */
export interface GitHubUnreadCounts {
  total: number;
  issue: number;
  pullRequest: number;
  reviewRequest: number;
}

/** GitHub comments unread counts */
export interface GitHubCommentsUnreadCounts {
  total: number;
  issueComment: number;
  reviewComment: number;
  review: number;
}

// ========== Storage Metrics 型定義 ==========

/** ストレージフォルダ情報 */
export interface StorageFolderMetrics {
  /** バイト数 */
  bytes: number;
  /** フォーマット済みサイズ */
  formatted: string;
  /** ファイル数 */
  fileCount: number;
}

/** 録音ストレージ情報 */
export interface RecordingsStorageMetrics extends StorageFolderMetrics {
  /** 日付別内訳 */
  byDate: Record<string, StorageFolderMetrics>;
}

/** ストレージメトリクス全体 */
export interface StorageMetrics {
  /** 録音フォルダ */
  recordings: RecordingsStorageMetrics;
  /** データベース */
  database: StorageFolderMetrics;
  /** ログフォルダ */
  logs: StorageFolderMetrics;
  /** 合計 */
  total: {
    bytes: number;
    formatted: string;
  };
}

// ========== Vocabulary 型定義 ==========

/** 用語登録元 */
export type VocabularySource = "manual" | "transcribe" | "feedback";

/** 用語辞書エントリ */
export interface Vocabulary {
  id: number;
  term: string;
  reading: string | null;
  category: string | null;
  source: VocabularySource;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

// ========== Task 型定義 ==========

/** タスクソース種別 */
export type TaskSourceType =
  | "slack"
  | "github"
  | "github-comment"
  | "memo"
  | "manual"
  | "prompt-improvement"
  | "profile-suggestion";

/** タスクステータス */
export type TaskStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "in_progress"
  | "paused"
  | "completed";

/** タスク優先度 */
export type TaskPriority = "high" | "medium" | "low";

/** タスク (各種ソースから抽出) */
export interface Task {
  id: number;
  date: string;
  slackMessageId: number | null;
  promptImprovementId: number | null;
  profileSuggestionId: number | null;
  projectId: number | null;
  sourceType: TaskSourceType;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  confidence: number | null;
  dueDate: string | null;
  extractedAt: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  rejectReason: string | null;
  pauseReason: string | null;
  originalTitle: string | null; // 修正前のタイトル (修正して承認した場合のみ)
  originalDescription: string | null; // 修正前の説明 (修正して承認した場合のみ)
  createdAt: string;
  updatedAt: string;
}

/** タスク抽出リクエスト */
export interface ExtractTasksRequest {
  date?: string;
  messageIds?: number[];
}

/** タスク抽出レスポンス */
export interface ExtractTasksResponse {
  extracted: number;
  tasks: Task[];
}

/** タスク更新リクエスト */
export interface UpdateTaskRequest {
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  rejectReason?: string;
}

/** タスク統計 */
export interface TaskStats {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  in_progress: number;
  paused: number;
  completed: number;
}

// ========== タスク完了検知 型定義 ==========

/** 完了検知ソース種別 */
export type CompletionSource = "github" | "claude-code" | "slack" | "transcribe";

/** タスク完了候補 */
export interface TaskCompletionSuggestion {
  taskId: number;
  task: Task;
  source: CompletionSource;
  reason: string;
  confidence: number;
  evidence?: string;
}

/** 完了候補取得レスポンス */
export interface SuggestCompletionsResponse {
  suggestions: TaskCompletionSuggestion[];
  evaluated: {
    total: number;
    github: number;
    claudeCode: number;
    slack: number;
    transcribe: number;
  };
}

/** Worker: 完了判定リクエスト */
export interface CheckCompletionRequest {
  task: {
    title: string;
    description: string | null;
  };
  context: string;
  source: "claude-code" | "slack" | "transcribe";
}

/** Worker: 完了判定レスポンス */
export interface CheckCompletionResponse {
  completed: boolean;
  confidence: number;
  reason: string;
  evidence?: string;
}

// ========== User Profile 型定義 ==========

/** ユーザープロフィール */
export interface UserProfile {
  id: number;
  experienceYears: number | null;
  specialties: string | null; // JSON string
  knownTechnologies: string | null; // JSON string
  learningGoals: string | null; // JSON string
  updatedAt: string;
}

/** プロフィール提案タイプ */
export type ProfileSuggestionType =
  | "add_technology"
  | "add_specialty"
  | "add_goal"
  | "update_experience";

/** プロフィール提案ソースタイプ */
export type ProfileSuggestionSourceType =
  | "claude-code"
  | "github"
  | "slack"
  | "transcription"
  | "learning";

/** プロフィール提案 */
export interface ProfileSuggestion {
  id: number;
  suggestionType: ProfileSuggestionType;
  field: string;
  value: string;
  reason: string | null;
  sourceType: ProfileSuggestionSourceType;
  sourceId: string | null;
  confidence: number | null;
  status: "pending" | "accepted" | "rejected";
  acceptedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

/** プロフィール更新リクエスト */
export interface UpdateProfileRequest {
  experienceYears?: number | null;
  specialties?: string[];
  knownTechnologies?: string[];
  learningGoals?: string[];
}

/** プロフィール提案生成リクエスト */
export interface GenerateProfileSuggestionsRequest {
  daysBack?: number; // デフォルト: 7日
}

/** プロフィール提案生成レスポンス */
export interface GenerateProfileSuggestionsResponse {
  generated: number;
  suggestions: ProfileSuggestion[];
}

// ========== Project 型定義 ==========

/** プロジェクト */
export interface Project {
  id: number;
  name: string;
  path: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** プロジェクト作成リクエスト */
export interface CreateProjectRequest {
  name: string;
  path?: string;
  githubOwner?: string;
  githubRepo?: string;
}

/** プロジェクト更新リクエスト */
export interface UpdateProjectRequest {
  name?: string;
  path?: string | null;
  githubOwner?: string | null;
  githubRepo?: string | null;
  isActive?: boolean;
}

/** プロジェクト自動検出レスポンス */
export interface AutoDetectProjectsResponse {
  detected: number;
  created: number;
  projects: Project[];
}

/** プロジェクト別統計 */
export interface ProjectStats {
  tasksCount: number;
  learningsCount: number;
}
