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
  createdAt: string;
}

/** 要約 */
export interface Summary {
  id: number;
  date: string;
  periodStart: string;
  periodEnd: string;
  summaryType: "hourly" | "daily";
  content: string;
  segmentIds: string;
  model: string;
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
  type?: "hourly" | "daily";
  hour?: number;
}

/** 要約生成レスポンス */
export interface GenerateSummaryResponse {
  success: boolean;
  content?: string | null;
  hourlyCount?: number;
  dailyGenerated?: boolean;
}
