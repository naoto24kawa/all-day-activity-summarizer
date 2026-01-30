# 抽出ログの統一管理

タスク抽出と学び抽出の処理済みソースを `extraction_logs` テーブルで一元管理。
0件でも「処理済み」として記録し、不要な AI 呼び出しを防止。

## ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `extraction_logs` |
| 共通ユーティリティ | `apps/cli/src/utils/extraction-log.ts` |

## テーブル構造

| カラム | 型 | 説明 |
|--------|-----|------|
| `extraction_type` | TEXT | `"task"` \| `"learning"` |
| `source_type` | TEXT | `"slack"` \| `"github"` \| `"github-comment"` \| `"memo"` \| `"claude-code"` \| `"transcription"` |
| `source_id` | TEXT | ソースの識別子 |
| `extracted_count` | INTEGER | 抽出された件数 |
| `extracted_at` | TEXT | 処理日時 |

## ユニーク制約

`(extraction_type, source_type, source_id)` の組み合わせで一意。

## API 使用例

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

## 対応する抽出処理

| 抽出タイプ | ソース | sourceId の形式 |
|-----------|--------|----------------|
| `task` | Slack | メッセージID (数値) |
| `task` | GitHub Comment | コメントID (数値) |
| `task` | Memo | メモID (数値) |
| `learning` | Claude Code | セッションID (UUID) |
| `learning` | Transcription | `transcription-YYYY-MM-DD` |
