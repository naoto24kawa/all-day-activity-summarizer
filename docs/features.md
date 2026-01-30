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

### フィードバックループ

- 承認/却下履歴から few-shot examples を自動構築
- 却下理由も学習に活用
- プロンプト改善案はタスクとして登録 (`sourceType: "prompt-improvement"`)
- プロフィール提案もタスクとして登録 (`sourceType: "profile-suggestion"`)

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
| パターン定義 | `apps/cli/src/commands/transcribe.ts` の `HALLUCINATION_PATTERNS` |
| 自動評価 | Claude SDK (haiku) による第2段階フィルタ |

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

## サマリ生成

### 概要

音声/メモ、Slack、Claude Code、タスク、学びを統合してサマリを生成。

### ファイル構成

| 種別 | パス |
|------|------|
| サマリ構築 | `apps/cli/src/summarizer/generator.ts` の `buildActivityText()` |

### 含まれるデータ

- 音声書き起こし/メモ
- Slack メッセージ
- Claude Code セッション
- タスク (承認済み)
- 学び

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
