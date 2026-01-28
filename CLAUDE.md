# CLAUDE.md

Claude Code 向け指示書。

**共通情報**: [AGENTS.md](AGENTS.md) を参照してください。

## Claude Code 固有の設定

### ツール使用ポリシー

- ファイル検索は `Glob` / `Grep` ツールを優先
- 複雑な探索は `Task` ツール(subagent_type=Explore)を使用
- 並列実行可能なツールは同時に呼び出す

### コード参照形式

コード参照時は `file_path:line_number` 形式を使用:

```
例: apps/cli/src/commands/record.ts:15
```

### コミットメッセージ

```
<type>: <description>

🤖 Generated with Claude Code
```

type: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

## プロジェクト固有の注意事項

### DB

- **bun:sqlite** を使用すること(better-sqlite3はBun未サポート)
- Drizzle ORMドライバは `drizzle-orm/bun-sqlite`
- `packages/db/src/index.ts` の `createDatabase()` を使用

### CLI

- エントリポイント: `apps/cli/src/index.ts`
- 実行: `bun run cli -- <command>`
- 設定: `~/.adas/config.json`(apps/cli/src/config.ts)
- 日付ユーティリティ: `apps/cli/src/utils/date.ts` の `getTodayDateString()` / `getDateString()` を使用(.split("T")[0]! のnon-null assertionを避ける)

### Whisper ハルシネーション対策

- 無音区間で Whisper が出力する定型文(「ご視聴ありがとうございました」等)をフィルタリングしている
- 対象: `apps/cli/src/commands/transcribe.ts` の `HALLUCINATION_PATTERNS` 配列
- 新しいパターンが見つかったら、この配列に正規表現を追加する
- **自動評価**: Claude SDK(haiku)による第2段階フィルタが有効。既存パターンを通過したテキストを非同期で評価し、ハルシネーション検出時は DB 削除 + パターン自動追加を行う
- 設定: `~/.adas/config.json` の `evaluator.enabled` / `evaluator.autoApplyPatterns` で制御(デフォルト: 両方 true)

### APIサーバー

- `apps/cli/src/server/app.ts` で Hono アプリ定義
- `createApp(db)` で DB を注入
- ルート: `apps/cli/src/server/routes/` 配下

### フロントエンド

- ダッシュボード: `apps/frontend/src/components/app/dashboard.tsx`
- ADAS API接続: `apps/frontend/src/hooks/use-adas-api.ts` のヘルパーを使用
- shadcn/ui コンポーネント追加は `apps/frontend` ディレクトリで実行
