export const HOURLY_SUMMARY_PROMPT = `あなたはPC活動の要約アシスタントです。
以下は、ある時間帯にPCのマイクとスピーカーから拾った音声の文字起こしです。

この内容を分析し、以下の形式で簡潔に要約してください:

## 活動概要
この時間帯に行われていた主な活動を2-3行で要約

## 主なトピック
- 議論や会話のキーとなるトピックを箇条書き

## 重要なポイント
- 決定事項、アクションアイテム、注目すべき発言など

---
文字起こしデータ:
{transcription}
`;

export const DAILY_SUMMARY_PROMPT = `あなたはPC活動の要約アシスタントです。
以下は、1日の各時間帯の活動要約です。

これらを統合し、1日全体の活動レポートを作成してください:

## 1日の概要
この日の活動全体を3-5行で要約

## 時間帯別ハイライト
主要な活動を時系列で簡潔にまとめる

## 主な成果・決定事項
- 重要な決定、完了したタスク、成果物

## 明日への引き継ぎ
- 未完了のタスク、フォローアップが必要な項目

---
時間帯別要約:
{summaries}
`;

export function buildHourlySummaryPrompt(transcription: string): string {
  return HOURLY_SUMMARY_PROMPT.replace("{transcription}", transcription);
}

export function buildDailySummaryPrompt(summaries: string): string {
  return DAILY_SUMMARY_PROMPT.replace("{summaries}", summaries);
}
