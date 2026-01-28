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
  createdAt: string;
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
  judgment: "hallucination" | "legitimate";
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
  hfToken?: string;
}

/** RPC Transcribe レスポンス */
export interface RpcTranscribeResponse {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
  }>;
  language: string;
  speakerEmbeddings?: Record<string, number[]>;
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
  segments: Array<{ text: string; start: number; end: number; speaker?: string }>;
}

/** RPC Evaluate レスポンス */
export interface RpcEvaluateResponse {
  judgment: "hallucination" | "legitimate";
  confidence: number;
  reason: string;
  suggestedPattern: string | null;
}

/** RPC Health レスポンス */
export interface RpcHealthResponse {
  status: "ok";
  whisperx: boolean;
  claude: boolean;
}
