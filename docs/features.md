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
