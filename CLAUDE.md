# CLAUDE.md

Claude Code 向け指示書。

**共通情報**: [AGENTS.md](AGENTS.md) を参照。

## 機能別ルール

機能の実装詳細は `.claude/rules/` を参照:

| 機能 | ルールファイル |
|------|---------------|
| タスク管理・完了検知 | `.claude/rules/tasks.md` |
| 単語帳 (Vocabulary) | `.claude/rules/vocabulary.md` |
| サマリ生成 | `.claude/rules/summary.md` |
| プロフィール | `.claude/rules/profile.md` |
| プロジェクト管理 | `.claude/rules/projects.md` |
| プロンプト改善 | `.claude/rules/prompt-improvement.md` |
| 抽出ログ | `.claude/rules/extraction-log.md` |
| Whisper 対策 | `.claude/rules/whisper.md` |
| 連携設定 | `.claude/rules/integrations-config.md` |

---

## ツール使用ポリシー

- ファイル検索は `Glob` / `Grep` ツールを優先
- 複雑な探索は `Task` ツール (subagent_type=Explore) を使用
- 並列実行可能なツールは同時に呼び出す

## コード参照形式

`file_path:line_number` 形式を使用:
```
例: apps/cli/src/commands/serve.ts:15
```

## コミットメッセージ

```
<type>: <description>

🤖 Generated with Claude Code
```

type: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

---

## 重要な制約事項

### Bun モジュール解決

**重要**: Bun はパッケージ内の全ファイルを解析するため、`index.ts` からエクスポートしていなくても依存関係が解決される。

```
# 例: Worker が @repo/core に依存 → core 内の @repo/db インポートでエラー
error: Cannot find module '@repo/db' from 'packages/core/src/some-file.ts'
```

**解決策**: `@repo/db` を使用するコードは `packages/core` ではなく `apps/cli` に配置。

### DB

- **bun:sqlite** を使用 (better-sqlite3 は Bun 未サポート)
- Drizzle ORM ドライバは `drizzle-orm/bun-sqlite`
- `packages/db/src/index.ts` の `createDatabase()` を使用

### 日付ユーティリティ

- `apps/cli/src/utils/date.ts` の `getTodayDateString()` / `getDateString()` を使用
- `.split("T")[0]!` の non-null assertion を避ける

---

## フロントエンド開発

### 基本

- ダッシュボード: `apps/frontend/src/components/app/dashboard.tsx`
- ADAS API 接続: `apps/frontend/src/hooks/use-adas-api.ts` のヘルパーを使用
- shadcn/ui コンポーネント追加は `apps/frontend` ディレクトリで実行

### UI/UX 実装方針

**モーダルのキーボードショートカット**:
- OKボタン (送信/確定) は `Cmd/Ctrl+Enter` で実行可能にする
- 実装例: `apps/frontend/src/components/app/feedback-dialog.tsx`

### ビルド確認

**重要**: `bun run build` はハングしやすいため、Claude が実行せずユーザーに依頼すること。

```
ビルドの確認をお願いします: bun run build
```

### Vite キャッシュクリア

`bun run dev` でハングする場合:

```bash
rm -rf apps/frontend/node_modules/.vite
bun run dev
```
