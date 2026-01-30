# API エンドポイント

## CLI APIサーバー(:3001)

### ヘルス・ステータス

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/health` | ヘルスチェック |
| GET | `/api/status` | 録音状態・本日の統計 |

### 文字起こし・要約

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/transcriptions?date=YYYY-MM-DD` | 文字起こし一覧 |
| GET | `/api/summaries?date=YYYY-MM-DD&type=pomodoro\|hourly\|daily` | 要約一覧 |
| POST | `/api/summaries/generate` | 手動要約トリガー |

### メモ

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/memos?date=YYYY-MM-DD` | メモ一覧 |
| POST | `/api/memos` | メモ作成 |

### 話者

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/speakers` | 登録済み話者一覧 |
| GET | `/api/speakers/unknown` | 未知話者一覧 |

### Slack

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/slack-messages?date=YYYY-MM-DD` | Slack メッセージ一覧 |
| GET | `/api/slack-messages/unread-count` | Slack 未読カウント |

### GitHub

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/github-items?date=YYYY-MM-DD` | GitHub Issue/PR 一覧 |
| GET | `/api/github-items/unread-count` | GitHub 未読カウント |
| PATCH | `/api/github-items/:id/read` | 既読にする |
| POST | `/api/github-items/mark-all-read` | 一括既読 |
| GET | `/api/github-comments?date=YYYY-MM-DD` | GitHub コメント一覧 |

### Claude Code

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/claude-code-sessions?date=YYYY-MM-DD` | Claude Code セッション一覧 |

### 学び (Learnings)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/learnings?date=YYYY-MM-DD` | 学び一覧 |
| GET | `/api/learnings/stats` | 学びの統計 |
| PUT | `/api/learnings/:id/review` | SM-2 復習記録 |
| DELETE | `/api/learnings/:id` | 学び削除 |

### タスク

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/tasks?date=YYYY-MM-DD&status=pending` | タスク一覧 |
| GET | `/api/tasks/for-ai` | AI向けタスク一覧 (Markdown、ブロック情報付き) |
| GET | `/api/tasks/stats` | タスク統計 |
| GET | `/api/tasks/:id/dependencies` | タスク依存関係取得 |
| POST | `/api/tasks/:id/dependencies` | 依存関係を手動追加 |
| DELETE | `/api/tasks/dependencies/:depId` | 依存関係を削除 |
| PATCH | `/api/tasks/:id` | タスク更新 (承認/却下/完了) |
| POST | `/api/tasks/:id/start` | タスクを実行中にする |
| POST | `/api/tasks/:id/pause` | タスクを中断する |
| POST | `/api/tasks/:id/complete` | タスクを完了にする |
| POST | `/api/tasks/:id/accept` | タスクを承認する (※1) |
| POST | `/api/tasks/:id/reject` | タスクを却下する |
| POST | `/api/tasks/extract` | Slack メッセージからタスク抽出 |
| POST | `/api/tasks/extract-github` | GitHub Items からタスク抽出 (※) |
| POST | `/api/tasks/extract-github-comments` | GitHub Comments からタスク抽出 (※) |
| POST | `/api/tasks/extract-memos` | メモからタスク抽出 |
| POST | `/api/tasks/suggest-completions` | 完了候補を検知・提案 |
| DELETE | `/api/tasks/:id` | タスク削除 |

※ `github.username` の設定が必要 (自分宛てのタスクのみ抽出)

※1 承認のみタスク (prompt-improvement, profile-suggestion, vocabulary) は承認時に自動で completed になる

#### タスク依存関係 API

**GET /api/tasks/:id/dependencies**

タスクの依存関係を取得。

```json
// レスポンス
{
  "blockedBy": [
    {
      "id": 1,
      "taskId": 5,
      "dependsOnTaskId": 3,
      "dependencyType": "blocks",
      "confidence": 0.9,
      "reason": "API実装が必要",
      "sourceType": "auto",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "dependsOnTask": { "id": 3, "title": "API 設計", "status": "accepted" }
    }
  ],
  "blocks": [
    {
      "id": 2,
      "taskId": 7,
      "dependsOnTaskId": 5,
      "dependencyType": "blocks",
      "confidence": 0.8,
      "reason": "実装完了後にテスト",
      "sourceType": "auto",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "blockedTask": { "id": 7, "title": "テスト作成", "status": "pending" }
    }
  ]
}
```

**POST /api/tasks/:id/dependencies**

依存関係を手動で追加。

```json
// リクエスト
{
  "dependsOnTaskId": 3,
  "dependencyType": "blocks",
  "reason": "API実装が必要なため"
}

// レスポンス (201 Created)
{
  "id": 1,
  "taskId": 5,
  "dependsOnTaskId": 3,
  "dependencyType": "blocks",
  "reason": "API実装が必要なため",
  "sourceType": "manual",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

### プロジェクト

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects?active=true` | プロジェクト一覧 |
| POST | `/api/projects` | プロジェクト作成 |
| GET | `/api/projects/:id` | プロジェクト取得 |
| PATCH | `/api/projects/:id` | プロジェクト更新 |
| DELETE | `/api/projects/:id` | プロジェクト削除 |
| GET | `/api/projects/:id/stats` | プロジェクト別統計 (タスク・学び数) |
| POST | `/api/projects/auto-detect` | Claude Code パスからプロジェクト自動検出 |

### 単語帳 (Vocabulary)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/vocabulary` | 登録済み用語一覧 |
| POST | `/api/vocabulary` | 用語を手動追加 |
| PUT | `/api/vocabulary/:id` | 用語を更新 |
| DELETE | `/api/vocabulary/:id` | 用語を削除 |
| GET | `/api/vocabulary/suggestions?status=pending` | 用語提案一覧 |
| POST | `/api/vocabulary/extract/slack` | Slack メッセージから用語抽出 |
| POST | `/api/vocabulary/extract/github` | GitHub から用語抽出 |
| POST | `/api/vocabulary/extract/claude-code` | Claude Code から用語抽出 |
| POST | `/api/vocabulary/extract/memo` | メモから用語抽出 |
| POST | `/api/vocabulary/extract/all` | 全ソースから一括抽出 |

単語帳は以下の機能で活用:
- Whisper 初期プロンプト (認識精度向上)
- サマリ生成 (表記揺れ防止)
- タスク抽出 (表記揺れ防止)
- 学び抽出 (表記揺れ防止)

### フィードバック

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/segment-feedbacks` | interpret フィードバック送信 |
| GET | `/api/segment-feedbacks?date=YYYY-MM-DD` | interpret フィードバック取得 |
| POST | `/api/feedbacks/v2` | summarize/evaluate フィードバック送信 |
| GET | `/api/feedbacks/v2?targetType=summary&date=YYYY-MM-DD` | フィードバック取得 |

### プロンプト改善

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/prompt-improvements` | 改善案一覧 |
| GET | `/api/prompt-improvements/stats` | 各ターゲットの統計 |
| POST | `/api/prompt-improvements/generate` | 改善案生成 |
| POST | `/api/prompt-improvements/:id/approve` | 承認 (プロンプト更新) |
| POST | `/api/prompt-improvements/:id/reject` | 却下 |

### ユーザープロフィール

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/profile` | プロフィール取得 |
| PUT | `/api/profile` | プロフィール更新 |
| GET | `/api/profile/suggestions?status=pending` | プロフィール提案一覧 |
| POST | `/api/profile/suggestions/generate` | 提案生成 (活動データから AI 分析) |
| POST | `/api/profile/suggestions/:id/accept` | 提案承認 (プロフィールに反映) |
| POST | `/api/profile/suggestions/:id/reject` | 提案却下 |
| DELETE | `/api/profile/suggestions/:id` | 提案削除 |

### 評価ログ

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/evaluator-logs?date=YYYY-MM-DD` | 評価ログ一覧 |

### 設定

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/config` | 連携設定の取得 (トークン等は除外) |
| PATCH | `/api/config/integrations` | 連携のオンオフ更新 |

#### PATCH /api/config/integrations

```json
// リクエスト例
{
  "slack": { "enabled": true },
  "github": { "enabled": false }
}

// レスポンス
{
  "message": "設定を更新しました",
  "requiresRestart": true,
  "integrations": {
    "slack": { "enabled": true },
    "github": { "enabled": false },
    "claudeCode": { "enabled": true },
    "evaluator": { "enabled": true },
    "promptImprovement": { "enabled": false }
  }
}
```

---

## Worker RPCサーバー(:3100)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/rpc/health` | ヘルスチェック(WhisperX/Claude 状態) |
| POST | `/rpc/transcribe` | WhisperX 文字起こし(multipart/form-data) |
| POST | `/rpc/summarize` | Claude 要約実行 |
| POST | `/rpc/interpret` | AI テキスト解釈 |
| POST | `/rpc/evaluate` | ハルシネーション評価 |
| POST | `/rpc/extract-learnings` | 学び抽出 (userProfile 対応) |
| POST | `/rpc/analyze-profile` | プロフィール提案生成 |
| POST | `/rpc/check-completion` | タスク完了判定 (AI) |
