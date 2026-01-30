# 機能詳細

各機能の実装詳細とファイル配置。

## タスク管理

### 概要

Slack/GitHub/メモから AI でタスクを自動抽出し、フィードバックループで精度向上。

### ファイル構成

| 種別 | パス |
|------|------|
| API | `apps/cli/src/server/routes/tasks.ts` |
| プロンプト | `packages/core/prompts/task-extract.md` |
| フロントエンド | `apps/frontend/src/components/app/tasks-panel.tsx` |

### タスクソース

| ソース | エンドポイント | 必要な設定 |
|--------|---------------|-----------|
| Slack | `POST /api/tasks/extract` | `slack.userId` |
| GitHub Items | `POST /api/tasks/extract-github` | `github.username` |
| GitHub Comments | `POST /api/tasks/extract-github-comments` | `github.username` |
| Memos | `POST /api/tasks/extract-memos` | - |

### タスクライフサイクル

```
pending → accepted → in_progress → completed
                  ↘ paused ↗
        → rejected
```

| ステータス | 説明 | エンドポイント |
|-----------|------|---------------|
| `pending` | 抽出直後、承認待ち | - |
| `accepted` | 承認済み、未着手 | `POST /api/tasks/:id/accept` |
| `in_progress` | 実行中 | `POST /api/tasks/:id/start` |
| `paused` | 中断 | `POST /api/tasks/:id/pause` |
| `completed` | 完了 | `POST /api/tasks/:id/complete` |
| `rejected` | 却下済み | `POST /api/tasks/:id/reject` |

### 承認のみタスク

以下の sourceType は「承認のみタスク」として扱われ、accept 時に自動的に completed になる:

| sourceType | 説明 |
|------------|------|
| `prompt-improvement` | プロンプト改善提案 |
| `profile-suggestion` | プロフィール提案 |
| `vocabulary` | 用語提案 |

これらのタスクは進行状態 (in_progress, paused) を持たず、フロントエンドでも進行状態ドロップダウンは表示されない。

**判定ロジック**: `packages/types/src/adas.ts` の `isApprovalOnlyTask()` 関数

### フィードバックループ

- 承認/却下履歴から few-shot examples を自動構築
- 却下理由も学習に活用
- プロンプト改善案はタスクとして登録 (`sourceType: "prompt-improvement"`)
- プロフィール提案もタスクとして登録 (`sourceType: "profile-suggestion"`)

### 類似タスク検知

抽出時に過去の完了・却下タスクとの類似性を AI が判断。類似タスクがある場合は警告を表示。

| フィールド | 説明 |
|-----------|------|
| `similarToTitle` | 類似する過去タスクのタイトル |
| `similarToStatus` | 類似タスクのステータス (`completed` / `rejected`) |
| `similarToReason` | 類似と判断した理由 |

**判断基準:**
- 同一タスクの再依頼 (タイトルや内容がほぼ同じ)
- 関連タスク (同じ機能・モジュールに関する別の依頼)

### タスク間依存関係

タスク自動抽出時に「AをやらないとBができない」というブロッキング関係を自動検出し、DBに保存。

#### 依存関係タイプ

| タイプ | 説明 |
|--------|------|
| `blocks` | 先行タスクが完了しないと着手できない |
| `related` | 関連はあるが独立して作業可能 |

#### 検出基準

- **明示的な依存**: 「〜が終わってから」「〜の後に」などの表現
- **技術的な依存**: API 実装 → フロントエンド実装など
- **論理的な順序**: 設計 → 実装 → テストなど

#### DB テーブル

`task_dependencies` テーブルで管理。

| カラム | 型 | 説明 |
|--------|-----|------|
| `task_id` | INTEGER | ブロックされる側 (後続タスク) |
| `depends_on_task_id` | INTEGER | ブロッカー (先行タスク) |
| `dependency_type` | TEXT | `blocks` / `related` |
| `confidence` | REAL | AI の確信度 (0-1) |
| `reason` | TEXT | 依存理由 |
| `source_type` | TEXT | `auto` / `manual` |

#### API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/tasks/:id/dependencies` | 依存関係取得 (blockedBy, blocks) |
| `POST` | `/api/tasks/:id/dependencies` | 手動で依存関係追加 |
| `DELETE` | `/api/tasks/dependencies/:depId` | 依存関係削除 |

#### for-ai エンドポイントでのブロック表示

`GET /api/tasks/for-ai` では、ブロックされているタスクに `[BLOCKED]` ラベルが付き、ブロッカータスクが表示される。
ブロックされていないタスクが優先的に上位に表示される。

### 抽出ログ (重複処理防止)

抽出処理の実行済み記録を `extraction_logs` テーブルで管理。タスクが0件でも「処理済み」として記録され、再処理を防止。

| sourceType | sourceId | 説明 |
|------------|----------|------|
| `slack` | メッセージID | Slack メッセージからのタスク抽出 |
| `github-comment` | コメントID | GitHub コメントからのタスク抽出 |
| `memo` | メモID | メモからのタスク抽出 |

詳細: [抽出ログの統一管理](#抽出ログの統一管理)

---

## タスク完了検知

### 概要

複数ソースから AI でタスク完了を自動検知。

### ファイル構成

| 種別 | パス |
|------|------|
| API | `POST /api/tasks/suggest-completions` |
| Worker | `apps/worker/src/routes/check-completion.ts` |
| GitHub クライアント | `apps/cli/src/github/client.ts` |

### 検知ソース (優先度順)

| ソース | 判定方法 | 確実性 |
|--------|---------|-------|
| GitHub | Issue/PR のクローズ・マージを API で確認 | 最高 |
| Claude Code | セッションログから AI 判定 | 中 |
| Slack | スレッド後続メッセージから AI 判定 | 中 |
| Transcribe | 音声書き起こしから AI 判定 | 低 |

### フロントエンド

Tasks タブの「承認済み」タブに「完了チェック」ボタン。

---

## ユーザープロフィール

### 概要

技術スキル・専門分野を管理し、学び抽出の精度向上に活用。

### ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `user_profile`, `profile_suggestions` |
| API | `apps/cli/src/server/routes/profile.ts` |
| フロントエンド | `apps/frontend/src/components/app/profile-panel.tsx` |
| Worker | `apps/worker/src/routes/analyze-profile.ts` |

### タスク統合

プロフィール提案は Tasks タブにタスクとして表示。

- 承認するとプロフィールに自動反映
- 却下すると提案も自動的に却下

### 学び抽出での活用

`apps/cli/src/claude-code/extractor.ts` でプロフィール情報を参照:
- 既知の技術の基礎的な内容を除外
- 学習目標に関連する内容を優先

---

## プロジェクト管理

### 概要

プロジェクト単位でタスク・学びを管理、GitHub リポジトリと連携。

### ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `projects` |
| API | `apps/cli/src/server/routes/projects.ts` |
| フロントエンド | `apps/frontend/src/components/app/projects-panel.tsx` |
| フック | `apps/frontend/src/hooks/use-projects.ts` |

### 機能

- プロジェクトの CRUD 操作
- Claude Code プロジェクトパスからの自動検出
- GitHub リポジトリとの紐付け (owner/repo)
- タスク・学びのプロジェクト別集計

---

## Whisper ハルシネーション対策

### 概要

無音区間での定型文 (「ご視聴ありがとうございました」等) をフィルタリング。

### ファイル構成

| 種別 | パス |
|------|------|
| パターン定義 (Single Source of Truth) | `apps/cli/src/whisper/hallucination-filter.ts` |
| AI 解釈プロンプト | `packages/core/prompts/interpret.md` |
| 評価プロンプト | `packages/core/prompts/evaluate.md` |
| 自動評価 | Claude SDK (haiku) による第2段階フィルタ |

### パターン参照

AI 解釈 (interpret.md) と評価 (evaluate.md) の両プロンプトから `hallucination-filter.ts` を参照。
パターンの追加・変更は `hallucination-filter.ts` で一元管理。

### 設定

`~/.adas/config.json`:
```json
{
  "evaluator": {
    "enabled": true,
    "autoApplyPatterns": true
  }
}
```

---

## 連携機能のオンオフ設定

### 概要

Slack、GitHub、Claude Code などの連携機能を UI から有効/無効に切り替え可能。

### ファイル構成

| 種別 | パス |
|------|------|
| API | `apps/cli/src/server/routes/config.ts` |
| フロントエンド | `apps/frontend/src/components/app/integrations-panel.tsx` |
| フック | `apps/frontend/src/hooks/use-config.ts` |
| 設定ファイル | `~/.adas/config.json` |

### API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/config` | 連携設定の取得 (トークン等は除外) |
| `PATCH` | `/api/config/integrations` | 連携のオンオフ更新 |

### 設定可能な連携

| 連携 | 設定キー | 説明 |
|------|----------|------|
| Whisper | `whisper.enabled` | 音声の自動文字起こし |
| Slack | `slack.enabled` | メンション・キーワード監視 |
| GitHub | `github.enabled` | Issue/PR 監視 |
| Claude Code | `claudeCode.enabled` | セッション履歴・学び抽出 |
| Evaluator | `evaluator.enabled` | 文字起こし品質評価 |
| Prompt Improvement | `promptImprovement.enabled` | プロンプト自動改善 |

### UI

Settings タブの「Integrations」パネルでトグル操作。

### 注意事項

- 設定変更後はサーバーの再起動が必要
- 無効化された連携のタブは「無効化されています」メッセージを表示
- 認証情報 (トークン等) が未設定の場合、トグルは無効化

---

## 単語帳 (Vocabulary)

### 概要

専門用語や固有名詞を登録し、音声認識・サマリ生成・タスク抽出・学び抽出の精度向上に活用。

### ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `vocabulary`, `vocabulary_suggestions` |
| API | `apps/cli/src/server/routes/vocabulary.ts` |
| CLI | `apps/cli/src/commands/vocab.ts` |
| フロントエンド | `apps/frontend/src/components/app/vocabulary-panel.tsx` |
| ユーティリティ | `apps/cli/src/utils/vocabulary.ts` |

### 単語帳の活用箇所

| 機能 | 使用方法 | ファイル |
|------|---------|---------|
| Whisper 初期プロンプト | 用語リストを `initial_prompt` として渡し認識精度向上 | `apps/cli/src/commands/transcribe.ts` |
| 解釈 (Interpret) | 既存用語を除外リストとして渡し重複抽出を防止 | `apps/cli/src/interpreter/run.ts` |
| 用語抽出 (Extract Terms) | 既存用語を除外リストとして渡し重複抽出を防止 | `apps/cli/src/server/routes/vocabulary.ts` |
| サマリ生成 | プロンプトに用語セクションを追加し表記揺れを防止 | `apps/cli/src/summarizer/prompts.ts` |
| タスク抽出 | プロンプトに用語セクションを追加し表記揺れを防止 | `apps/cli/src/server/routes/tasks.ts` |
| 学び抽出 | Worker へ用語リストを渡しプロンプトに追加 | `apps/cli/src/claude-code/extractor.ts`, `apps/worker/src/routes/extract-learnings.ts` |

### 用語セクションの形式

各機能のプロンプトに以下の形式で追加:
```
## 用語辞書
以下の用語は正確に使用してください (表記揺れを避ける):
用語1、用語2、用語3...
```

### 用語登録フロー

```
手動登録 ─────────────────────────────────────────────────→ vocabulary
音声認識 → Interpret → extractedTerms → vocabulary_suggestions → 承認 → vocabulary
各種抽出 → /api/vocabulary/extract/* → vocabulary_suggestions → 承認 → vocabulary
```

### ソース種別

| ソース | 説明 |
|--------|------|
| `manual` | 手動登録 |
| `transcribe` | 音声認識からの抽出 |
| `feedback` | フィードバックからの抽出 |
| `interpret` | 解釈処理からの抽出 |

---

## サマリ生成

### 概要

音声/メモ、Slack、GitHub、Claude Code、タスク、学びを統合してサマリを生成。
内容は「個人作業」と「チーム活動」のセクションに自動分類される。
単語帳に登録された用語を参照し、表記揺れを防止。

### ファイル構成

| 種別 | パス |
|------|------|
| サマリ構築 | `apps/cli/src/summarizer/generator.ts` の `buildActivityTextWithSections()` |
| 時間単位プロンプト | `packages/core/prompts/summarize-hourly.md` |
| 日次プロンプト | `packages/core/prompts/summarize-daily.md` |

### 含まれるデータ

サマリには以下のデータが含まれ、自動的に分類される:

#### 個人作業

| データ種別 | 説明 |
|-----------|------|
| 音声 (独り言) | mic 音声で他者の発話がない場合 |
| メモ | ユーザーが手動で入力したメモ |
| Claude Code セッション | AI アシスタントとの開発セッション |
| タスク | 承認済み/完了したタスク |
| 学び | セッションから抽出された学び |

#### チーム活動

| データ種別 | 説明 |
|-----------|------|
| ミーティング音声 | system 音声、または他者の発話がある場合 |
| Slack メッセージ | メンション、DM、チャネルメッセージ |
| GitHub Items | Issue、Pull Request の更新 |
| GitHub Comments | コードレビュー、コメント |

### 音声の分類ロジック

音声セグメントは以下のルールで分類:

1. `audioSource = "system"` → チーム活動 (会議音声)
2. `audioSource = "mic"` かつ他者 (speaker != "Me") の発話あり → チーム活動 (ミーティング)
3. `audioSource = "mic"` かつ自分のみ → 個人作業 (独り言)

### 出力形式

#### 時間単位 (pomodoro/hourly)

```markdown
## 個人作業
この時間帯に行った個人での作業内容

## チーム活動
チームとのコミュニケーションやコラボレーション

## 重要なポイント
- 決定事項、アクションアイテムなど
```

#### 日次 (daily)

```markdown
## 1日の概要
この日の活動全体の要約

## 個人作業のハイライト
主要な個人での開発作業、学び、完了したタスク

## チーム活動のハイライト
主要なコミュニケーション、コラボレーション

## 主な成果・決定事項
- 重要な決定、完了したタスク、成果物

## 明日への引き継ぎ
- 未完了のタスク (該当がある場合のみ)
```

---

## 抽出ログの統一管理

### 概要

タスク抽出と学び抽出の処理済みソースを `extraction_logs` テーブルで一元管理。
0件でも「処理済み」として記録し、不要な AI 呼び出しを防止。

### ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `extraction_logs` |
| 共通ユーティリティ | `apps/cli/src/utils/extraction-log.ts` |

### テーブル構造

| カラム | 型 | 説明 |
|--------|-----|------|
| `extraction_type` | TEXT | `"task"` \| `"learning"` |
| `source_type` | TEXT | `"slack"` \| `"github"` \| `"github-comment"` \| `"memo"` \| `"claude-code"` \| `"transcription"` |
| `source_id` | TEXT | ソースの識別子 (ID または日付ベースの識別子) |
| `extracted_count` | INTEGER | 抽出された件数 |
| `extracted_at` | TEXT | 処理日時 |

### ユニーク制約

`(extraction_type, source_type, source_id)` の組み合わせで一意。

### API

```typescript
import { hasExtractionLog, recordExtractionLog } from "../utils/extraction-log.js";

// 処理済みかチェック
if (hasExtractionLog(db, "task", "slack", String(messageId))) {
  return; // スキップ
}

// 抽出処理実行...

// ログ記録 (0件でも記録)
recordExtractionLog(db, "task", "slack", String(messageId), extractedCount);
```

### 対応する抽出処理

| 抽出タイプ | ソース | sourceId の形式 |
|-----------|--------|----------------|
| `task` | Slack | メッセージID (数値) |
| `task` | GitHub Comment | コメントID (数値) |
| `task` | Memo | メモID (数値) |
| `learning` | Claude Code | セッションID (UUID) |
| `learning` | Transcription | `transcription-YYYY-MM-DD` |
| `learning` | GitHub Comment | `github-comment-YYYY-MM-DD` |
| `learning` | Slack | `slack-message-YYYY-MM-DD` |
