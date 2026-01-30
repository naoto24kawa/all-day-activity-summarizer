# プロジェクト管理

プロジェクト単位でタスク・学びを管理、GitHub リポジトリと連携。

## ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `projects` |
| API | `apps/cli/src/server/routes/projects.ts` |
| フロントエンド | `apps/frontend/src/components/app/projects-panel.tsx` |
| フック | `apps/frontend/src/hooks/use-projects.ts` |

## 機能

- プロジェクトの CRUD 操作
- Claude Code プロジェクトパスからの自動検出
- GitHub リポジトリとの紐付け (owner/repo)
- タスク・学びのプロジェクト別集計
