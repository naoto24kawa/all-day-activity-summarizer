---
name: task
description: Manages ADAS tasks via API. Creates, lists, updates, completes, and extracts tasks from various sources. Use when saying "タスク作成", "タスク追加", "タスク一覧", "タスク完了", "タスク抽出", "/task" or any task-related operations.
allowed-tools: [Bash, Read, Glob, Grep]
---

# ADAS Task Manager

Manages tasks through ADAS API - create, list, update, complete, and extract tasks.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Reference](#quick-reference)
3. [Operations](#operations)
4. [Common Workflows](#common-workflows)
5. [Error Handling](#error-handling)

## Prerequisites

- API server running on port 3001 (or user-specified port)
- Task API available at `/api/tasks`

**API Reference**: `.claude/rules/tasks.md`

---

## Quick Reference

| 操作 | コマンド |
|------|---------|
| 一覧 | `GET /api/tasks?status={status}` |
| 作成 | `POST /api/tasks` |
| 更新 | `PATCH /api/tasks/{id}` |
| 完了 | `POST /api/tasks/{id}/complete` |
| 抽出 | `POST /api/tasks/extract` |

---

## Operations

### 1. タスク一覧表示

```bash
# ステータスでフィルタ (pending / accepted / in_progress / completed / rejected)
curl -s "http://localhost:3001/api/tasks?status=accepted" | jq
```

**パラメータ**: `status`, `projectId`, `limit` (default: 100)

**Verification**: レスポンスが配列で、各要素に `id`, `title`, `status` が含まれる

**Error Handling**:
- Connection refused → API サーバー起動確認、ポート番号をユーザーに確認
- Empty array → 「該当するタスクがありません」と報告

---

### 2. タスク作成

```bash
curl -s -X POST "http://localhost:3001/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "タスク名",
    "description": "詳細説明",
    "priority": "high",
    "workType": "create"
  }' | jq
```

**必須**: `title`
**任意**: `description`, `priority` (high/medium/low), `workType`, `dueDate`, `projectId`

**Verification**: レスポンスに `id` が含まれ、HTTP 201 が返る

**Error Handling**:
- 400 Bad Request → title が空でないか確認
- Connection refused → API サーバー起動確認

**Response Example**:
```json
{
  "id": 123,
  "title": "タスク名",
  "status": "accepted",
  "priority": "high"
}
```

---

### 3. タスク更新

```bash
curl -s -X PATCH "http://localhost:3001/api/tasks/{id}" \
  -H "Content-Type: application/json" \
  -d '{"priority": "high"}' | jq
```

**Verification**: レスポンスに更新後の値が反映されている

**Error Handling**:
- 404 → タスク ID が存在しない。一覧で確認を促す
- 400 → 無効なフィールド値

---

### 4. ステータス変更

```bash
# 承認 (pending → accepted)
curl -s -X POST "http://localhost:3001/api/tasks/{id}/accept"

# 開始 (accepted → in_progress)
curl -s -X POST "http://localhost:3001/api/tasks/{id}/start"

# 完了
curl -s -X POST "http://localhost:3001/api/tasks/{id}/complete"

# 却下
curl -s -X POST "http://localhost:3001/api/tasks/{id}/reject" \
  -H "Content-Type: application/json" \
  -d '{"reason": "理由"}'

# 一時停止
curl -s -X POST "http://localhost:3001/api/tasks/{id}/pause" \
  -H "Content-Type: application/json" \
  -d '{"reason": "理由"}'
```

**ライフサイクル**:
```
pending → accepted → in_progress → completed
                  ↘ paused ↗
        → rejected
```

**Verification**: レスポンスの `status` が期待値に変わっている

**Error Handling**:
- 400 → 無効な状態遷移 (例: pending から直接 complete は不可)
- 404 → タスク ID 不在

---

### 5. タスク削除

```bash
curl -s -X DELETE "http://localhost:3001/api/tasks/{id}"
```

**⚠️ 重要**: 削除は取り消せない。実行前にユーザー確認を推奨

**Verification**: HTTP 200/204 が返る

**Error Handling**:
- 404 → 既に削除済みまたは ID 不在

---

### 6. タスク抽出

```bash
# Slack から
curl -s -X POST "http://localhost:3001/api/tasks/extract" \
  -H "Content-Type: application/json" \
  -d '{"date": "'"$(date +%Y-%m-%d)"'"}' | jq

# GitHub Items から
curl -s -X POST "http://localhost:3001/api/tasks/extract-github" \
  -H "Content-Type: application/json" \
  -d '{"date": "'"$(date +%Y-%m-%d)"'"}' | jq

# メモから
curl -s -X POST "http://localhost:3001/api/tasks/extract-memos" \
  -H "Content-Type: application/json" \
  -d '{"date": "'"$(date +%Y-%m-%d)"'"}' | jq
```

**Verification**: `extractedCount` または `tasks` 配列がレスポンスに含まれる

**Error Handling**:
- 抽出件数 0 → 「新しいタスクは見つかりませんでした」と報告
- 設定不足 → 必要な設定 (slack.userId, github.username) を確認

---

### 7. 依存関係

```bash
# 取得
curl -s "http://localhost:3001/api/tasks/{id}/dependencies" | jq

# 追加
curl -s -X POST "http://localhost:3001/api/tasks/{id}/dependencies" \
  -H "Content-Type: application/json" \
  -d '{"dependsOnTaskId": 5, "type": "blocks"}' | jq
```

**type**: `blocks` (ブロック) / `related` (関連のみ)

**Verification**: 依存関係オブジェクトがレスポンスに含まれる

---

### 8. 詳細化 (Elaboration)

```bash
# 詳細化実行
curl -s -X POST "http://localhost:3001/api/tasks/{id}/elaborate" | jq

# 結果取得
curl -s "http://localhost:3001/api/tasks/{id}/elaboration" | jq

# 適用
curl -s -X POST "http://localhost:3001/api/tasks/{id}/elaboration/apply" \
  -H "Content-Type: application/json" \
  -d '{"updateParentDescription": true, "createChildTasks": true}' | jq
```

**Verification**: `elaborationStatus` が `completed` または `applied` になる

---

### 9. 完了検知・重複検知

```bash
# 完了候補を提案
curl -s -X POST "http://localhost:3001/api/tasks/suggest-completions" \
  -H "Content-Type: application/json" \
  -d '{"date": "'"$(date +%Y-%m-%d)"'"}' | jq

# 重複検知
curl -s -X POST "http://localhost:3001/api/tasks/detect-duplicates" | jq

# マージ
curl -s -X POST "http://localhost:3001/api/tasks/merge" \
  -H "Content-Type: application/json" \
  -d '{"sourceTaskIds": [1, 2], "targetTitle": "統合タスク"}' | jq
```

**Verification**: suggestions 配列または duplicates 配列が返る

---

### 10. GitHub Issue 作成

```bash
curl -s -X POST "http://localhost:3001/api/tasks/{id}/create-issue" \
  -H "Content-Type: application/json" \
  -d '{"owner": "org-name", "repo": "repo-name"}' | jq
```

**Verification**: `issueUrl` がレスポンスに含まれる

**Error Handling**:
- 401 → GitHub トークン未設定
- 404 → リポジトリが見つからない

---

## Common Workflows

### タスクを作成して開始

```bash
# 1. 作成
TASK=$(curl -s -X POST "http://localhost:3001/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title": "機能Xを実装", "priority": "high"}')
TASK_ID=$(echo $TASK | jq -r '.id')
echo "Created task: $TASK_ID"

# 2. 開始
curl -s -X POST "http://localhost:3001/api/tasks/$TASK_ID/start" | jq
```

### 今日のタスクを確認して作業開始

```bash
# 1. accepted タスク一覧
curl -s "http://localhost:3001/api/tasks?status=accepted" | jq '.[] | {id, title, priority}'

# 2. 最初のタスクを開始
FIRST_ID=$(curl -s "http://localhost:3001/api/tasks?status=accepted&limit=1" | jq -r '.[0].id')
curl -s -X POST "http://localhost:3001/api/tasks/$FIRST_ID/start"
```

---

## Error Handling

| エラー | 原因 | 対処 |
|--------|------|------|
| Connection refused | API 未起動 | `bun run serve` で起動確認 |
| 404 Not Found | ID 不在 | 一覧で ID を確認 |
| 400 Bad Request | パラメータ不正 | 必須フィールド・値を確認 |
| 401 Unauthorized | 認証エラー | トークン設定を確認 |

---

## Important Notes

- **削除・ステータス変更は不可逆** - 重要な操作は事前にユーザー確認
- **非同期エンドポイント** (`/async`) はジョブ ID を返す。結果は別途取得が必要
- **デフォルトポート**: 3001
