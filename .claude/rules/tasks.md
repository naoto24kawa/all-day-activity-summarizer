# タスク管理

Slack/GitHub/メモから AI でタスクを自動抽出し、フィードバックループで精度向上。

## ファイル構成

| 種別 | パス |
|------|------|
| API | `apps/cli/src/server/routes/tasks.ts` |
| プロンプト | `packages/core/prompts/task-extract.md` |
| フロントエンド | `apps/frontend/src/components/app/tasks-panel.tsx` |

---

## API エンドポイント一覧

### 基本 CRUD

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/tasks` | タスク一覧取得 |
| `POST` | `/api/tasks` | 手動タスク作成 |
| `GET` | `/api/tasks/:id` | 単一タスク取得 |
| `PATCH` | `/api/tasks/:id` | タスク更新 |
| `DELETE` | `/api/tasks/:id` | タスク削除 |
| `PATCH` | `/api/tasks/batch` | 複数タスク一括更新 |

### ステータス変更

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/tasks/:id/accept` | 承認 (pending → accepted) |
| `POST` | `/api/tasks/:id/reject` | 却下 (pending → rejected) |
| `POST` | `/api/tasks/:id/start` | 開始 (accepted → in_progress) |
| `POST` | `/api/tasks/:id/pause` | 一時停止 (in_progress → paused) |
| `POST` | `/api/tasks/:id/complete` | 完了 (→ completed) |

### タスク抽出

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/tasks/extract` | Slack から抽出 |
| `POST` | `/api/tasks/extract/async` | Slack から抽出 (非同期) |
| `POST` | `/api/tasks/extract-github` | GitHub Items から抽出 |
| `POST` | `/api/tasks/extract-github/async` | GitHub Items から抽出 (非同期) |
| `POST` | `/api/tasks/extract-github-comments` | GitHub Comments から抽出 |
| `POST` | `/api/tasks/extract-github-comments/async` | GitHub Comments から抽出 (非同期) |
| `POST` | `/api/tasks/extract-memos` | メモから抽出 |
| `POST` | `/api/tasks/extract-memos/async` | メモから抽出 (非同期) |
| `POST` | `/api/tasks/extract-logs` | サーバーログから抽出 |
| `POST` | `/api/tasks/extract-transcription` | 音声セグメントから抽出 |
| `POST` | `/api/tasks/extract-transcription/async` | 音声セグメントから抽出 (非同期) |
| `POST` | `/api/tasks/extract-claude-code` | Claude Code セッションから抽出 |
| `POST` | `/api/tasks/extract-claude-code/async` | Claude Code セッションから抽出 (非同期) |
| `POST` | `/api/tasks/extract-notion` | Notion アイテムから抽出 |
| `POST` | `/api/tasks/extract-notion/async` | Notion アイテムから抽出 (非同期) |

### 依存関係

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/tasks/:id/dependencies` | 依存関係取得 |
| `POST` | `/api/tasks/:id/dependencies` | 依存関係追加 |
| `DELETE` | `/api/tasks/dependencies/:depId` | 依存関係削除 |

### 詳細化 (Elaboration)

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/tasks/:id/elaborate` | タスク詳細化実行 |
| `GET` | `/api/tasks/:id/elaboration` | 詳細化結果取得 |
| `POST` | `/api/tasks/:id/elaboration/apply` | 詳細化結果を適用 |
| `POST` | `/api/tasks/:id/elaboration/discard` | 詳細化結果を破棄 |
| `GET` | `/api/tasks/:id/children` | 子タスク一覧取得 |
| `POST` | `/api/tasks/bulk-elaborate` | 一括詳細化開始 |
| `GET` | `/api/tasks/bulk-elaboration-status` | 一括詳細化ステータス |

### 完了検知・重複検知

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/tasks/suggest-completions` | 完了候補を提案 |
| `POST` | `/api/tasks/suggest-completions/async` | 完了候補を提案 (非同期) |
| `GET` | `/api/tasks/suggest-completions/result/:jobId` | 完了提案結果取得 |
| `POST` | `/api/tasks/detect-duplicates` | 重複タスク検知 |
| `POST` | `/api/tasks/:id/check-similarity` | 類似タスクチェック |
| `POST` | `/api/tasks/check-similarity-batch` | 類似タスク一括チェック |
| `POST` | `/api/tasks/merge` | タスクマージ |

### その他

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/tasks/for-ai` | AI エージェント向けタスク一覧 (Markdown) |
| `GET` | `/api/tasks/stats` | タスク統計 |
| `GET` | `/api/tasks/:id/ai-text` | AI 用タスクテキスト取得 |
| `POST` | `/api/tasks/:id/create-issue` | GitHub Issue 作成 |

---

## 手動タスク作成

`POST /api/tasks` で手動タスクを作成。

**リクエスト**:
```json
{
  "title": "タスク名",           // 必須
  "description": "詳細説明",     // 任意
  "priority": "high",           // high | medium | low | someday
  "workType": "create",         // create | investigate | review | communicate | operate | learn | plan | maintain
  "dueDate": "2026-02-10",      // YYYY-MM-DD
  "projectId": 1,               // プロジェクトID
  "date": "2026-02-02",         // 登録日 (デフォルト: 今日)
  "status": "accepted"          // pending | accepted (デフォルト: accepted)
}
```

**レスポンス**: 作成されたタスクオブジェクト (HTTP 201)

---

## タスクライフサイクル

```
pending → accepted → in_progress → completed
        ↘        ↘ paused ↗
        → rejected
```

| ステータス | 説明 |
|-----------|------|
| `pending` | 抽出直後、承認待ち |
| `accepted` | 承認済み、未着手 |
| `in_progress` | 実行中 |
| `paused` | 中断 |
| `completed` | 完了 |
| `rejected` | 却下済み |

## タスク優先度

| 優先度 | 説明 |
|--------|------|
| `high` | 高優先度 (赤) |
| `medium` | 中優先度 (黄) |
| `low` | 低優先度 (緑) |
| `someday` | いつか (紫) - 後で検討 |

---

## 承認のみタスク

以下の sourceType は「承認のみタスク」として扱われ、accept 時に自動的に completed になる:

| sourceType | 説明 |
|------------|------|
| `prompt-improvement` | プロンプト改善提案 |
| `profile-suggestion` | プロフィール提案 |
| `vocabulary` | 用語提案 |
| `merge` | タスクマージ提案 |
| `project-suggestion` | プロジェクト提案 |

**判定ロジック**: `packages/types/src/adas.ts` の `isApprovalOnlyTask()` 関数

---

## 類似タスク検知

抽出時に過去の完了・却下タスクとの類似性を AI が判断。

| フィールド | 説明 |
|-----------|------|
| `similarToTitle` | 類似する過去タスクのタイトル |
| `similarToStatus` | 類似タスクのステータス |
| `similarToReason` | 類似と判断した理由 |

---

## タスク間依存関係

タスク自動抽出時に「AをやらないとBができない」というブロッキング関係を自動検出。

| タイプ | 説明 |
|--------|------|
| `blocks` | 先行タスクが完了しないと着手できない |
| `related` | 関連はあるが独立して作業可能 |

**DB テーブル**: `task_dependencies`

---

## タスク完了検知

複数ソースから AI でタスク完了を自動検知。

| ソース | 判定方法 | 確実性 |
|--------|---------|-------|
| GitHub | Issue/PR のクローズ・マージを API で確認 | 最高 |
| Claude Code | セッションログから AI 判定 | 中 |
| Slack | スレッド後続メッセージから AI 判定 | 中 |
| Transcribe | 音声書き起こしから AI 判定 | 低 |

---

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

---

## 音声セグメントからのタスク抽出

音声書き起こしから「TODO」「あとで」「対応が必要」などの言及を AI で検出してタスク化。

**エンドポイント**: `POST /api/tasks/extract-transcription`

**リクエスト**:
```json
{
  "date": "YYYY-MM-DD",              // 省略時: 今日
  "aggregationType": "time_window"   // "time_window" | "speaker"
}
```

**集約方式**:
- `time_window`: 30分単位で集約 (推奨)
- `speaker`: 話者別に集約

**DB カラム**: `tasks.transcriptionSegmentId`

---

## Claude Code セッションからのタスク抽出

開発セッションから TODO/FIXME、改善提案、未解決問題を AI で検出してタスク化。

**エンドポイント**: `POST /api/tasks/extract-claude-code`

**リクエスト**:
```json
{
  "date": "YYYY-MM-DD",          // 省略時: 今日
  "confidenceThreshold": 0.5    // AI 確信度の閾値 (0.0-1.0)
}
```

**タスク vs 学びの境界**:
- タスク: 「〜する必要がある」「〜すべき」→ 具体的なアクションが必要
- 学び: 「〜だと分かった」「〜という仕組み」→ 知識・ベストプラクティス

**プロンプト**: `packages/core/prompts/task-extract-claude-code.md`

**DB カラム**: `tasks.claudeCodeSessionId`

---

## Notion からのタスク抽出

Notion アイテムからタスク化すべき内容を AI で検出。プロパティ (Priority, Due Date) も活用。

**エンドポイント**: `POST /api/tasks/extract-notion`

**リクエスト**:
```json
{
  "date": "YYYY-MM-DD",       // 省略時: 今日
  "databaseId": "xxx"         // 特定の DB のみ対象 (省略時: 全て)
}
```

**Notion プロパティ活用**:
| Notion プロパティ | タスクフィールド |
|------------------|-----------------|
| Priority | priority |
| Due Date / Due | dueDate |

**DB カラム**: `tasks.sourceId` (Notion Page ID)
