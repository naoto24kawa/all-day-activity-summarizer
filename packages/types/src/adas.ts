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
  summaryType: "times" | "daily";
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
  projectId: number | null; // FK to projects
  createdAt: string;
}

/** メモ一覧レスポンス (ページネーション対応) */
export interface MemosResponse {
  memos: Memo[];
  total: number;
  hasMore: boolean;
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
  type?: "times" | "daily";
  /** times 用: 開始時間 (0-23) */
  startHour?: number;
  /** times 用: 終了時間 (0-23) */
  endHour?: number;
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
  /** 単一ジョブの場合 */
  jobId?: number;
  /** 複数ジョブの場合 */
  jobIds?: number[];
  message?: string;
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

/** 抽出された用語 */
export interface ExtractedTerm {
  term: string;
  reading?: string;
  category?: string;
  confidence: number;
  reason?: string;
}

/** RPC Interpret レスポンス */
export interface RpcInterpretResponse {
  interpretedText: string;
  extractedTerms?: ExtractedTerm[];
}

/** プロンプト改善ターゲット */
export type PromptTarget =
  | "interpret"
  | "evaluate"
  | "summarize-times"
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

/** RPC Suggest Memo Tags リクエスト */
export interface RpcSuggestMemoTagsRequest {
  content: string;
}

/** RPC Suggest Memo Tags レスポンス */
export interface RpcSuggestMemoTagsResponse {
  tags: MemoTag[];
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
  messageType: "mention" | "channel" | "dm" | "keyword";
  text: string;
  threadTs: string | null;
  permalink: string | null;
  isRead: boolean;
  projectId: number | null; // FK to projects
  /** 有効プロジェクトID (メッセージ > チャンネル > 自動検索 の優先順) */
  effectiveProjectId?: number | null;
  createdAt: string;
}

/** Slack チャンネル (プロジェクト紐づけ用) */
export interface SlackChannel {
  id: number;
  channelId: string;
  channelName: string | null;
  projectId: number | null; // FK to projects
  createdAt: string;
  updatedAt: string;
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
  projectId: number | null; // FK to projects
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

/** Claude Code プロジェクトパス (プロジェクト紐づけ用) */
export interface ClaudeCodePath {
  id: number;
  projectPath: string;
  projectName: string | null;
  projectId: number | null; // FK to projects
  createdAt: string;
  updatedAt: string;
}

/** 学びソース種別 */
export type LearningSourceType =
  | "claude-code"
  | "transcription"
  | "github-comment"
  | "slack-message"
  | "manual";

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
  projectId: number | null; // FK to projects (auto-assigned by repoOwner/repoName match)
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
export type VocabularySource = "manual" | "transcribe" | "feedback" | "interpret";

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

/** 用語提案ソース種別 */
export type VocabularySuggestionSourceType =
  | "interpret"
  | "feedback"
  | "slack"
  | "github"
  | "claude-code"
  | "memo";

/** 用語提案ステータス */
export type VocabularySuggestionStatus = "pending" | "accepted" | "rejected";

/** 用語提案 */
export interface VocabularySuggestion {
  id: number;
  term: string;
  reading: string | null;
  category: string | null;
  reason: string | null;
  sourceType: VocabularySuggestionSourceType;
  sourceId: number | null;
  confidence: number | null;
  status: VocabularySuggestionStatus;
  acceptedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
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
  | "profile-suggestion"
  | "vocabulary"
  | "merge"
  | "project-suggestion"
  | "server-log";

/** 承認のみで完了するタスクのソース種別 */
export const APPROVAL_ONLY_SOURCE_TYPES: TaskSourceType[] = [
  "prompt-improvement",
  "profile-suggestion",
  "vocabulary",
  "merge",
  "project-suggestion",
];

/** 承認のみで完了するタスクかどうかを判定 */
export function isApprovalOnlyTask(sourceType: TaskSourceType): boolean {
  return APPROVAL_ONLY_SOURCE_TYPES.includes(sourceType);
}

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

/** タスク業務パターン */
export type WorkType =
  | "create" // 新しく作る (開発、資料作成、企画書、デザイン)
  | "investigate" // 調べる・分析する (調査、リサーチ、分析、比較検討)
  | "review" // 確認・評価する (レビュー、チェック、監査、品質確認)
  | "communicate" // 伝える・調整する (会議、報告、連絡、交渉、依頼)
  | "operate" // 実行・対応する (運用作業、問い合わせ対応、手続き)
  | "learn" // 学ぶ・習得する (学習、研修、キャッチアップ)
  | "plan" // 計画・設計する (計画立案、スケジュール調整、設計)
  | "maintain"; // 整理・改善する (整理、リファクタ、改善、更新)

/** 業務パターン定数 */
export const WORK_TYPES: WorkType[] = [
  "create",
  "investigate",
  "review",
  "communicate",
  "operate",
  "learn",
  "plan",
  "maintain",
];

/** 業務パターンラベル */
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  create: "作成",
  investigate: "調査",
  review: "確認",
  communicate: "連絡",
  operate: "対応",
  learn: "学習",
  plan: "計画",
  maintain: "改善",
};

/** タスク (各種ソースから抽出) */
export interface Task {
  id: number;
  date: string;
  slackMessageId: number | null;
  promptImprovementId: number | null;
  profileSuggestionId: number | null;
  vocabularySuggestionId: number | null;
  projectSuggestionId: number | null;
  projectId: number | null;
  sourceType: TaskSourceType;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  workType: WorkType | null; // 業務パターン
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
  similarToTitle: string | null; // 類似する過去タスクのタイトル
  similarToStatus: "completed" | "rejected" | null; // 類似タスクのステータス
  similarToReason: string | null; // 類似と判断した理由
  // マージ関連
  mergeSourceTaskIds: string | null; // JSON array: 統合元タスクのID配列 (sourceType="merge" 時のみ)
  mergeTargetTaskId: number | null; // 統合先タスクID (統合された側に設定)
  mergedAt: string | null; // 統合された日時 (統合された側に設定)
  // 親子タスク・詳細化関連
  parentId: number | null; // 親タスク ID (子タスクの場合のみ)
  elaborationStatus: ElaborationStatus | null; // 詳細化ステータス
  pendingElaboration: string | null; // JSON: 詳細化結果 (適用前)
  stepNumber: number | null; // 子タスクの順序 (1, 2, 3...)
  // GitHub Issue 連携
  githubIssueNumber: number | null; // 作成した Issue の番号
  githubIssueUrl: string | null; // 作成した Issue の URL
  createdAt: string;
  updatedAt: string;
  // 用語タスク用: 抽出元ソース種別 (vocabulary suggestion から取得)
  vocabularySuggestionSourceType?: VocabularySuggestionSourceType | null;
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

/** サーバーログからのタスク抽出リクエスト */
export interface ExtractTasksFromLogsRequest {
  /** ログソース ("serve" | "worker") */
  source: "serve" | "worker";
  /** 対象日付 (YYYY-MM-DD、省略時は今日) */
  date?: string;
  /** 対象ログレベル (省略時は ["ERROR", "WARN"]) */
  levels?: string[];
  /** 処理上限 (省略時は 50) */
  limit?: number;
}

/** サーバーログからのタスク抽出レスポンス */
export interface ExtractTasksFromLogsResponse {
  /** 抽出されたタスク数 */
  extracted: number;
  /** 処理したログエントリ数 */
  processed: number;
  /** スキップしたエントリ数 (処理済み) */
  skipped: number;
  /** グループ化されたエラー数 */
  grouped: number;
  /** 抽出されたタスク */
  tasks: Task[];
}

/** タスク更新リクエスト */
export interface UpdateTaskRequest {
  status?: TaskStatus;
  priority?: TaskPriority;
  workType?: WorkType | null;
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

// ========== Task Dependency 型定義 ==========

/** 依存関係タイプ */
export type TaskDependencyType = "blocks" | "related";

/** 依存関係ソースタイプ */
export type TaskDependencySourceType = "auto" | "manual";

/** タスク依存関係 (DB レコード) */
export interface TaskDependency {
  id: number;
  taskId: number; // ブロックされる側 (後続タスク)
  dependsOnTaskId: number; // ブロッカー (先行タスク)
  dependencyType: TaskDependencyType;
  confidence: number | null;
  reason: string | null;
  sourceType: TaskDependencySourceType;
  createdAt: string;
}

/** 抽出されたタスク依存関係 (プロンプト出力用) */
export interface ExtractedTaskDependency {
  type: TaskDependencyType;
  taskTitle: string; // 依存先タスクのタイトル (同バッチ内タスクまたは既存タスクのタイトル)
  reason: string;
  confidence: number;
}

/** タスク依存関係作成リクエスト */
export interface CreateTaskDependencyRequest {
  dependsOnTaskId: number;
  dependencyType?: TaskDependencyType;
  reason?: string;
}

/** タスク依存関係レスポンス (タスク情報付き) */
export interface TaskDependencyWithTask extends TaskDependency {
  dependsOnTask?: {
    id: number;
    title: string;
    status: TaskStatus;
  };
  blockedTask?: {
    id: number;
    title: string;
    status: TaskStatus;
  };
}

/** タスク依存関係一覧レスポンス */
export interface TaskDependenciesResponse {
  /** このタスクをブロックしているタスク (先行タスク) */
  blockedBy: TaskDependencyWithTask[];
  /** このタスクがブロックしているタスク (後続タスク) */
  blocks: TaskDependencyWithTask[];
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
    /** 子タスク情報 (親タスクの完了判定時) */
    childTasks?: {
      stepNumber: number;
      title: string;
      status: TaskStatus;
    }[];
    /** 親タスク情報 (子タスクの完了判定時) */
    parentTask?: {
      id: number;
      title: string;
    };
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

// ========== タスク重複検出 型定義 ==========

/** 重複タスクペア */
export interface DuplicateTaskPair {
  /** タスク A の ID */
  taskAId: number;
  /** タスク A のタイトル */
  taskATitle: string;
  /** タスク B の ID */
  taskBId: number;
  /** タスク B のタイトル */
  taskBTitle: string;
  /** 類似度 (0-1) */
  similarity: number;
  /** 重複と判断した理由 */
  reason: string;
  /** 統合後のタイトル案 */
  mergedTitle: string;
  /** 統合後の説明案 */
  mergedDescription: string | null;
}

/** 重複検出リクエスト */
export interface DetectDuplicatesRequest {
  /** 対象日付 (省略時は全 accepted タスク) */
  date?: string;
  /** 対象プロジェクト ID */
  projectId?: number;
  /** 最小類似度 (0-1, デフォルト: 0.7) */
  minSimilarity?: number;
}

/** 重複検出レスポンス */
export interface DetectDuplicatesResponse {
  /** 検出された重複ペア */
  duplicates: DuplicateTaskPair[];
  /** 評価したタスク数 */
  evaluated: number;
}

/** マージタスク作成リクエスト */
export interface CreateMergeTaskRequest {
  /** 統合元タスク ID の配列 */
  sourceTaskIds: number[];
  /** 統合後のタイトル */
  title: string;
  /** 統合後の説明 */
  description?: string;
  /** 優先度 */
  priority?: "high" | "medium" | "low";
  /** プロジェクト ID */
  projectId?: number;
}

/** マージタスク作成レスポンス */
export interface CreateMergeTaskResponse {
  /** 作成されたマージタスク */
  mergeTask: Task;
  /** 統合元タスク */
  sourceTasks: Task[];
}

/** Worker: 重複検出リクエスト */
export interface CheckDuplicatesRequest {
  /** 評価対象のタスク一覧 */
  tasks: Array<{
    id: number;
    title: string;
    description: string | null;
  }>;
  /** 最小類似度 (0-1, デフォルト: 0.7) */
  minSimilarity?: number;
}

/** Worker: 重複検出レスポンス */
export interface CheckDuplicatesResponse {
  /** 検出された重複ペア */
  duplicates: DuplicateTaskPair[];
}

// ========== タスク類似チェック 型定義 ==========

/** 類似チェック結果 */
export interface SimilarityCheckResult {
  taskId: number;
  updated: boolean;
  similarToTitle: string | null;
  similarToStatus: "completed" | "rejected" | null;
  similarToReason: string | null;
}

/** 個別タスク類似チェックレスポンス */
export interface CheckTaskSimilarityResponse {
  updated: boolean;
  similarTo: {
    title: string;
    status: "completed" | "rejected";
    reason: string;
  } | null;
}

/** 一括類似チェックリクエスト */
export interface CheckSimilarityBatchRequest {
  /** 対象日付 (省略時は全 pending タスク) */
  date?: string;
  /** 対象プロジェクト ID */
  projectId?: number;
  /** 対象タスク ID 一覧 (省略時は全 pending タスク) */
  taskIds?: number[];
}

/** 一括類似チェックレスポンス */
export interface CheckSimilarityBatchResponse {
  /** チェックしたタスク数 */
  checked: number;
  /** 更新したタスク数 (類似が見つかった数) */
  updated: number;
  /** 各タスクの結果 */
  results: SimilarityCheckResult[];
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
  excludedAt: string | null; // ソフトデリート用 (スキャン除外)
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

/** Git リポジトリスキャン結果 */
export interface GitRepoScanResult {
  path: string;
  name: string;
  remoteUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
}

/** Git リポジトリスキャン実行レスポンス */
export interface ScanGitReposResponse {
  scanned: number;
  created: number;
  skipped: number;
  repos: GitRepoScanResult[];
}

/** プロジェクト設定 */
export interface ProjectsConfig {
  gitScanPaths: string[];
  excludePatterns: string[];
}

/** プロジェクト別統計 */
export interface ProjectStats {
  tasksCount: number;
  learningsCount: number;
}

/** プロジェクト提案ソース種別 */
export type ProjectSuggestionSourceType = "git-scan" | "claude-code" | "github";

/** プロジェクト提案ステータス */
export type ProjectSuggestionStatus = "pending" | "accepted" | "rejected";

/** プロジェクト提案 */
export interface ProjectSuggestion {
  id: number;
  name: string;
  path: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  reason: string | null;
  sourceType: ProjectSuggestionSourceType;
  sourceId: string | null;
  confidence: number | null;
  status: ProjectSuggestionStatus;
  acceptedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

// ========== AI Processing Log 型定義 ==========

/** AI処理ログの処理タイプ */
export type AiProcessType =
  | "transcribe"
  | "evaluate"
  | "interpret"
  | "extract-learnings"
  | "explain-learning"
  | "summarize"
  | "check-completion"
  | "extract-terms"
  | "analyze-profile"
  | "suggest-tags"
  | "match-channels";

/** AI処理ログのステータス */
export type AiProcessStatus = "success" | "error";

/** AI処理ログ */
export interface AiProcessingLog {
  id: number;
  date: string;
  processType: AiProcessType;
  status: AiProcessStatus;
  model: string | null;
  inputSize: number | null;
  outputSize: number | null;
  durationMs: number;
  errorMessage: string | null;
  metadata: string | null; // JSON
  createdAt: string;
}

/** AI処理ログ記録リクエスト */
export interface CreateAiProcessingLogRequest {
  date: string;
  processType: AiProcessType;
  status: AiProcessStatus;
  model?: string;
  inputSize?: number;
  outputSize?: number;
  durationMs: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

// ========== Task Elaboration 型定義 ==========

/** タスク詳細化レベル */
export type ElaborationLevel = "light" | "standard" | "detailed";

/** タスク詳細化リクエスト */
export interface ElaborateTaskRequest {
  /** ユーザーからの追加指示 (初回詳細化時) */
  userInstruction?: string;
  /** 修正依頼時: 現在の詳細化結果 */
  currentElaboration?: string;
  /** 修正依頼時: 修正指示 */
  revisionInstruction?: string;
  /** 詳細化レベル (省略時は設定のデフォルト値) */
  level?: ElaborationLevel;
}

/** タスク詳細化レスポンス */
export interface ElaborateTaskResponse {
  /** 詳細化された説明 */
  elaboration: string;
  /** コードベースを参照したか */
  codebaseReferenced: boolean;
  /** 参照したファイルパス */
  referencedFiles?: string[];
}

/** 一括詳細化リクエスト */
export interface BulkElaborateTasksRequest {
  taskIds: number[];
  userInstruction?: string;
  /** 詳細化レベル (省略時は設定のデフォルト値) */
  level?: ElaborationLevel;
}

/** 一括詳細化の個別結果 */
export interface BulkElaborateTaskResult {
  taskId: number;
  taskTitle: string;
  success: boolean;
  elaboration?: string;
  referencedFiles?: string[];
  error?: string;
}

/** 一括詳細化レスポンス */
export interface BulkElaborateTasksResponse {
  results: BulkElaborateTaskResult[];
  totalSucceeded: number;
  totalFailed: number;
}

/** 一括詳細化開始レスポンス (非同期) */
export interface BulkElaborateStartResponse {
  taskIds: number[];
  jobIds: number[];
  status: "pending";
  message: string;
}

/** 一括詳細化状態の個別ステータス */
export interface BulkElaborationTaskStatus {
  taskId: number;
  status: ElaborationStatus | null;
  hasResult: boolean;
}

/** 一括詳細化状態レスポンス */
export interface BulkElaborationStatusResponse {
  statuses: BulkElaborationTaskStatus[];
  summary: {
    pending: number;
    completed: number;
    failed: number;
    total: number;
  };
  allCompleted: boolean;
}

// ========== 非同期タスク詳細化 型定義 ==========

/** 詳細化ステータス */
export type ElaborationStatus = "pending" | "completed" | "failed" | "applied";

/** 詳細化開始レスポンス (非同期) */
export interface StartElaborationResponse {
  jobId: number;
  status: "pending";
}

/** 詳細化結果 (pending_elaboration に保存される JSON) */
export interface ElaborationResult {
  /** 親タスクの詳細説明 (Markdown) */
  elaboration: string;
  /** 子タスク (実装ステップ) */
  childTasks: ElaborationChildTask[];
  /** 参照したファイル */
  referencedFiles: string[];
}

/** 詳細化で生成される子タスク */
export interface ElaborationChildTask {
  /** タスクタイトル */
  title: string;
  /** タスク説明 */
  description: string | null;
  /** ステップ番号 (1, 2, 3...) */
  stepNumber: number;
}

/** 詳細化状態取得レスポンス */
export interface ElaborationStatusResponse {
  /** タスク ID */
  taskId: number;
  /** 詳細化ステータス */
  status: ElaborationStatus | null;
  /** ジョブ ID (pending 状態の場合) */
  jobId: number | null;
  /** ジョブステータス (pending 状態の場合) */
  jobStatus: AIJobStatus | null;
  /** 詳細化結果 (completed 状態の場合) */
  result: ElaborationResult | null;
  /** エラーメッセージ (failed 状態の場合) */
  errorMessage: string | null;
}

/** 詳細化結果適用リクエスト */
export interface ApplyElaborationRequest {
  /** 親タスクの説明を更新するかどうか (デフォルト: true) */
  updateParentDescription?: boolean;
  /** 子タスクを作成するかどうか (デフォルト: true) */
  createChildTasks?: boolean;
  /** 子タスクの編集 (タイトルや説明の上書き) */
  childTaskEdits?: Array<{
    stepNumber: number;
    title?: string;
    description?: string;
    /** false に設定するとその子タスクをスキップ */
    include?: boolean;
  }>;
}

/** 詳細化結果適用レスポンス */
export interface ApplyElaborationResponse {
  /** 更新された親タスク */
  parentTask: Task;
  /** 作成された子タスク */
  childTasks: Task[];
}

/** 子タスク一覧レスポンス */
export interface ChildTasksResponse {
  /** 子タスク一覧 (stepNumber 順) */
  childTasks: Task[];
  /** 子タスク数 */
  total: number;
}

// ========== AI Job Queue 型定義 ==========

/** AIジョブタイプ */
export type AIJobType =
  | "task-extract-slack"
  | "task-extract-github"
  | "task-extract-github-comment"
  | "task-extract-memo"
  | "task-elaborate"
  | "task-check-completion"
  | "learning-extract"
  | "vocabulary-extract"
  | "profile-analyze"
  | "summarize-times"
  | "summarize-daily"
  | "claude-chat";

/** AIジョブステータス */
export type AIJobStatus = "pending" | "processing" | "completed" | "failed";

/** AIジョブ */
export interface AIJob {
  id: number;
  jobType: AIJobType;
  params: string | null; // JSON
  status: AIJobStatus;
  result: string | null; // JSON
  resultSummary: string | null;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  lockedAt: string | null;
  runAfter: string;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

/** AIジョブ登録リクエスト */
export interface CreateAIJobRequest {
  jobType: AIJobType;
  params?: Record<string, unknown>;
  runAfter?: string; // ISO8601, 省略時は即時実行
}

/** AIジョブ登録レスポンス */
export interface CreateAIJobResponse {
  jobId: number;
  status: AIJobStatus;
}

/** AIジョブ統計 */
export interface AIJobStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

/** SSEイベント: ジョブ完了 */
export interface AIJobCompletedEvent {
  jobId: number;
  jobType: AIJobType;
  status: AIJobStatus;
  resultSummary: string | null;
}

// ========== Slack Channel Matching 型定義 ==========

/** Slack チャンネル情報 (マッチング用) */
export interface SlackChannelInfo {
  channelId: string;
  channelName: string;
}

/** プロジェクト情報 (マッチング用) */
export interface ProjectInfo {
  id: number;
  name: string;
  githubOwner: string | null;
  githubRepo: string | null;
}

/** チャンネルとプロジェクトのマッチング結果 */
export interface ChannelProjectMatch {
  channelId: string;
  channelName: string;
  projectId: number;
  projectName: string;
  confidence: number;
  reason: string;
}

/** RPC Match Slack Channels リクエスト */
export interface RpcMatchSlackChannelsRequest {
  channels: SlackChannelInfo[];
  projects: ProjectInfo[];
}

/** RPC Match Slack Channels レスポンス */
export interface RpcMatchSlackChannelsResponse {
  matches: ChannelProjectMatch[];
}

// ========== Rate Limit 型定義 ==========

/** レート制限優先度 */
export type RateLimitPriority = "high" | "medium" | "low" | "lowest";

/** レート制限設定 */
export interface RateLimitConfig {
  enabled: boolean;
  limits: RateLimitLimits;
  priorityMultipliers: RateLimitPriorityMultipliers;
}

/** レート制限値 */
export interface RateLimitLimits {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
}

/** 優先度別の制限係数 */
export interface RateLimitPriorityMultipliers {
  high: number;
  medium: number;
  low: number;
  lowest: number;
}

/** 現在の使用状況 */
export interface RateLimitCurrentUsage {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
}

/** 使用状況の制限に対する割合 (%) */
export interface RateLimitUsagePercent {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
}

/** レート制限ステータス */
export interface RateLimitStatus {
  enabled: boolean;
  currentUsage: RateLimitCurrentUsage;
  limits: RateLimitLimits;
  usagePercent: RateLimitUsagePercent;
}

/** レート制限チェック結果 */
export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  currentUsage: RateLimitCurrentUsage;
}

// ========== GitHub Issue 作成 型定義 ==========

/** GitHub Issue 作成リクエスト */
export interface CreateGitHubIssueRequest {
  /** タスクに紐づくプロジェクトのリポジトリを使用 (デフォルト) */
  useProjectRepo?: boolean;
  /** 手動で owner/repo を指定する場合 */
  owner?: string;
  repo?: string;
}

/** GitHub Issue 作成レスポンス */
export interface CreateGitHubIssueResponse {
  /** 作成された Issue 番号 */
  issueNumber: number;
  /** Issue の URL */
  issueUrl: string;
  /** 更新されたタスク */
  task: Task;
}
