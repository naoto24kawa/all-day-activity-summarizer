# タスク管理

Slack/GitHub/メモから AI でタスクを自動抽出し、フィードバックループで精度向上。

## ファイル構成

| 種別 | パス |
|------|------|
| API | `apps/cli/src/server/routes/tasks.ts` |
| プロンプト | `packages/core/prompts/task-extract.md` |
| フロントエンド | `apps/frontend/src/components/app/tasks-panel.tsx` |

## タスクソース

| ソース | エンドポイント | 必要な設定 |
|--------|---------------|-----------|
| Slack | `POST /api/tasks/extract` | `slack.userId` |
| GitHub Items | `POST /api/tasks/extract-github` | `github.username` |
| GitHub Comments | `POST /api/tasks/extract-github-comments` | `github.username` |
| Memos | `POST /api/tasks/extract-memos` | - |
| Server Logs | `POST /api/tasks/extract-logs` | - |

## タスクライフサイクル

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

## 承認のみタスク

以下の sourceType は「承認のみタスク」として扱われ、accept 時に自動的に completed になる:

| sourceType | 説明 |
|------------|------|
| `prompt-improvement` | プロンプト改善提案 |
| `profile-suggestion` | プロフィール提案 |
| `vocabulary` | 用語提案 |

**判定ロジック**: `packages/types/src/adas.ts` の `isApprovalOnlyTask()` 関数

## 類似タスク検知

抽出時に過去の完了・却下タスクとの類似性を AI が判断。

| フィールド | 説明 |
|-----------|------|
| `similarToTitle` | 類似する過去タスクのタイトル |
| `similarToStatus` | 類似タスクのステータス |
| `similarToReason` | 類似と判断した理由 |

## タスク間依存関係

タスク自動抽出時に「AをやらないとBができない」というブロッキング関係を自動検出。

| タイプ | 説明 |
|--------|------|
| `blocks` | 先行タスクが完了しないと着手できない |
| `related` | 関連はあるが独立して作業可能 |

**DB テーブル**: `task_dependencies`

**API**: `GET/POST /api/tasks/:id/dependencies`, `DELETE /api/tasks/dependencies/:depId`

## タスク完了検知

複数ソースから AI でタスク完了を自動検知。

| ソース | 判定方法 | 確実性 |
|--------|---------|-------|
| GitHub | Issue/PR のクローズ・マージを API で確認 | 最高 |
| Claude Code | セッションログから AI 判定 | 中 |
| Slack | スレッド後続メッセージから AI 判定 | 中 |
| Transcribe | 音声書き起こしから AI 判定 | 低 |

## サーバーログからのタスク抽出

サーバーログ (serve/worker) から ERROR/WARN レベルのエントリを AI で解析し、対応すべきタスクを自動抽出。

**エンドポイント**: `POST /api/tasks/extract-logs`

**リクエスト**:
```json
{
  "source": "serve" | "worker",
  "date": "YYYY-MM-DD",     // 省略時: 今日
  "levels": ["ERROR", "WARN"], // 省略時: ["ERROR", "WARN"]
  "limit": 50               // 省略時: 50 (最大 50)
}
```

**処理フロー**:
1. ログファイルを読み込み
2. レベルでフィルタ
3. 処理済みエントリを除外 (extraction_logs でチェック)
4. 類似エラーをグループ化
5. Claude Haiku でタスク抽出
6. DB 保存 + 抽出ログ記録

**ログエントリ識別子**: `{source}-{date}-{hash}`
- hash: timestamp + level + message (正規化済み) の MD5 先頭 8 文字

**プロンプト**: `packages/core/prompts/task-extract-logs.md`

**workType**: `investigate` / `operate` / `maintain`
