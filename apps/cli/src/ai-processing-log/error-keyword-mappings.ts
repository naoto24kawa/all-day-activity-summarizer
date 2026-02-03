/**
 * AI Processing Log Error Keyword Mappings
 *
 * エラーメッセージのキーワードとタスク生成ルールのマッピング定義
 */

import type { WorkType } from "@repo/types";

export interface ErrorKeywordMapping {
  /** マッチするキーワード (大文字小文字を区別しない) */
  keywords: string[];
  /** 生成するタスクのタイトルテンプレート (${processType} でプロセスタイプを挿入) */
  titleTemplate: string;
  /** タスクの説明テンプレート */
  descriptionTemplate?: string;
  /** 優先度 */
  priority: "high" | "medium" | "low";
  /** 業務パターン */
  workType: WorkType;
}

/**
 * エラーキーワードからタスク生成ルールへのマッピング
 *
 * 順序が重要: 上から順にマッチを試みる
 */
export const ERROR_KEYWORD_MAPPINGS: ErrorKeywordMapping[] = [
  // 接続エラー
  {
    keywords: ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "connection refused"],
    titleTemplate: "[${processType}] 接続エラーの調査",
    descriptionTemplate:
      "外部サービスへの接続に失敗しています。ネットワーク設定、サービスの稼働状況を確認してください。",
    priority: "high",
    workType: "investigate",
  },
  // レート制限
  {
    keywords: ["rate limit", "429", "too many requests", "rate_limit_exceeded"],
    titleTemplate: "[${processType}] レート制限への対応",
    descriptionTemplate:
      "API のレート制限に達しています。リクエスト頻度の調整やバックオフ戦略の見直しを検討してください。",
    priority: "medium",
    workType: "operate",
  },
  // 認証エラー
  {
    keywords: ["401", "Unauthorized", "invalid_api_key", "authentication failed", "auth error"],
    titleTemplate: "[${processType}] 認証エラーの解決",
    descriptionTemplate:
      "認証に失敗しています。API キーやトークンの有効期限、設定を確認してください。",
    priority: "high",
    workType: "operate",
  },
  // 権限エラー
  {
    keywords: ["403", "Forbidden", "permission denied", "access denied"],
    titleTemplate: "[${processType}] 権限エラーの調査",
    descriptionTemplate: "アクセス権限がありません。必要な権限の確認・付与を行ってください。",
    priority: "high",
    workType: "investigate",
  },
  // メモリ不足
  {
    keywords: ["out of memory", "OOM", "heap out of memory", "memory limit"],
    titleTemplate: "[${processType}] メモリ不足の対応",
    descriptionTemplate:
      "メモリ不足が発生しています。処理のバッチサイズ縮小やメモリ設定の見直しを検討してください。",
    priority: "high",
    workType: "maintain",
  },
  // ファイル未検出
  {
    keywords: ["ENOENT", "file not found", "no such file", "path not found"],
    titleTemplate: "[${processType}] ファイル未検出の調査",
    descriptionTemplate:
      "指定されたファイルが見つかりません。パスの確認、ファイルの存在確認を行ってください。",
    priority: "medium",
    workType: "investigate",
  },
  // JSON パースエラー
  {
    keywords: ["JSON.parse", "invalid json", "Unexpected token", "SyntaxError"],
    titleTemplate: "[${processType}] レスポンス解析エラーの調査",
    descriptionTemplate:
      "JSON の解析に失敗しています。API レスポンスの形式変更やデータ破損を確認してください。",
    priority: "medium",
    workType: "investigate",
  },
  // タイムアウト
  {
    keywords: ["timeout", "timed out", "request timeout", "deadline exceeded"],
    titleTemplate: "[${processType}] タイムアウトエラーの調査",
    descriptionTemplate:
      "処理がタイムアウトしました。タイムアウト設定の調整や処理の最適化を検討してください。",
    priority: "medium",
    workType: "investigate",
  },
  // サーバーエラー
  {
    keywords: ["500", "Internal Server Error", "502", "503", "504", "Bad Gateway"],
    titleTemplate: "[${processType}] サーバーエラーの確認",
    descriptionTemplate:
      "外部サービスでサーバーエラーが発生しています。サービスの状態を確認してください。",
    priority: "low",
    workType: "investigate",
  },
  // モデルエラー (AI固有)
  {
    keywords: ["model not found", "invalid model", "model_not_available"],
    titleTemplate: "[${processType}] AI モデル設定の確認",
    descriptionTemplate: "指定されたモデルが利用できません。モデル名や設定を確認してください。",
    priority: "medium",
    workType: "operate",
  },
  // トークン制限 (AI固有)
  {
    keywords: ["token limit", "max tokens", "context length exceeded", "too many tokens"],
    titleTemplate: "[${processType}] トークン制限の対応",
    descriptionTemplate: "入力がトークン制限を超えています。入力の分割や要約を検討してください。",
    priority: "medium",
    workType: "operate",
  },
  // ディスク容量
  {
    keywords: ["ENOSPC", "no space left", "disk full", "quota exceeded"],
    titleTemplate: "[${processType}] ディスク容量不足の対応",
    descriptionTemplate:
      "ディスク容量が不足しています。不要ファイルの削除や容量の拡張を行ってください。",
    priority: "high",
    workType: "maintain",
  },
];

/**
 * エラーメッセージにマッチするマッピングを検索
 */
export function findMatchingMapping(errorMessage: string): ErrorKeywordMapping | null {
  const lowerMessage = errorMessage.toLowerCase();

  for (const mapping of ERROR_KEYWORD_MAPPINGS) {
    const matched = mapping.keywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase()),
    );
    if (matched) {
      return mapping;
    }
  }

  return null;
}

/**
 * タイトルテンプレートにプロセスタイプを埋め込む
 */
export function formatTitle(template: string, processType: string): string {
  return template.replace(/\$\{processType\}/g, processType);
}
