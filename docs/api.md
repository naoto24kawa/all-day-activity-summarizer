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

### フィードバック

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/segment-feedbacks` | interpret フィードバック送信 |
| GET | `/api/segment-feedbacks?date=YYYY-MM-DD` | interpret フィードバック取得 |
| POST | `/api/feedbacks/v2` | summarize/evaluate フィードバック送信 |
| GET | `/api/feedbacks/v2?targetType=summary&date=YYYY-MM-DD` | フィードバック取得 |

### 評価ログ

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/evaluator-logs?date=YYYY-MM-DD` | 評価ログ一覧 |

---

## Worker RPCサーバー(:3100)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/rpc/health` | ヘルスチェック(WhisperX/Claude 状態) |
| POST | `/rpc/transcribe` | WhisperX 文字起こし(multipart/form-data) |
| POST | `/rpc/summarize` | Claude 要約実行 |
| POST | `/rpc/interpret` | AI テキスト解釈 |
| POST | `/rpc/evaluate` | ハルシネーション評価 |
