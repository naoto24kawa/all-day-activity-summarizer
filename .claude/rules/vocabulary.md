# 単語帳 (Vocabulary)

専門用語や固有名詞を登録し、音声認識・サマリ生成・タスク抽出・学び抽出の精度向上に活用。

## ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `vocabulary`, `vocabulary_suggestions` |
| API | `apps/cli/src/server/routes/vocabulary.ts` |
| CLI | `apps/cli/src/commands/vocab.ts` |
| フロントエンド | `apps/frontend/src/components/app/vocabulary-panel.tsx` |
| ユーティリティ | `apps/cli/src/utils/vocabulary.ts` |

## 活用箇所

| 機能 | 使用方法 | ファイル |
|------|---------|---------|
| Whisper 初期プロンプト | 用語リストを `initial_prompt` として渡し認識精度向上 | `apps/cli/src/commands/transcribe.ts` |
| 解釈 (Interpret) | 既存用語を除外リストとして渡し重複抽出を防止 | `apps/cli/src/interpreter/run.ts` |
| サマリ生成 | プロンプトに用語セクションを追加し表記揺れを防止 | `apps/cli/src/summarizer/prompts.ts` |
| タスク抽出 | プロンプトに用語セクションを追加し表記揺れを防止 | `apps/cli/src/server/routes/tasks.ts` |
| 学び抽出 | Worker へ用語リストを渡しプロンプトに追加 | `apps/cli/src/claude-code/extractor.ts` |

## 用語セクションの形式

```
## 用語辞書
以下の用語は正確に使用してください (表記揺れを避ける):
用語1、用語2、用語3...
```

## 用語登録フロー

```
手動登録 ─────────────────────────────────────────────────→ vocabulary
音声認識 → Interpret → extractedTerms → vocabulary_suggestions → 承認 → vocabulary
各種抽出 → /api/vocabulary/extract/* → vocabulary_suggestions → 承認 → vocabulary
```

## ソース種別

| ソース | 説明 |
|--------|------|
| `manual` | 手動登録 |
| `transcribe` | 音声認識からの抽出 |
| `feedback` | フィードバックからの抽出 |
| `interpret` | 解釈処理からの抽出 |
