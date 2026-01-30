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
例: apps/cli/src/commands/serve.ts:15
```

### コミットメッセージ

```
<type>: <description>

🤖 Generated with Claude Code
```

type: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

---

## プロジェクト固有の注意事項

### Bun モジュール解決

**重要**: Bun はパッケージ内の全ファイルを解析するため、`index.ts` からエクスポートしていなくても依存関係が解決される。

```
# 例: Worker が @repo/core に依存 → core 内の @repo/db インポートでエラー
error: Cannot find module '@repo/db' from 'packages/core/src/some-file.ts'
```

**解決策**:
- `@repo/db` を使用するコードは `packages/core` ではなく `apps/cli` に配置
- 現在 `apps/cli/src/feedback-injector.ts` はこの理由で CLI 内に配置

### DB

- **bun:sqlite** を使用(better-sqlite3 は Bun 未サポート)
- Drizzle ORM ドライバは `drizzle-orm/bun-sqlite`
- `packages/db/src/index.ts` の `createDatabase()` を使用

### 日付ユーティリティ

- `apps/cli/src/utils/date.ts` の `getTodayDateString()` / `getDateString()` を使用
- `.split("T")[0]!` の non-null assertion を避ける

### AI 解釈(interpret)

- 共通ロジック: `apps/cli/src/interpreter/run.ts` の `interpretSegments()`
- `transcribe` コマンド(自動)と `interpret` コマンド(手動)の両方から呼ばれる
- Worker の `/rpc/interpret` エンドポイントを使用

### Whisper ハルシネーション対策

- 無音区間での定型文(「ご視聴ありがとうございました」等)をフィルタリング
- 対象: `apps/cli/src/commands/transcribe.ts` の `HALLUCINATION_PATTERNS` 配列
- **自動評価**: Claude SDK(haiku)による第2段階フィルタが有効
- 設定: `~/.adas/config.json` の `evaluator.enabled` / `evaluator.autoApplyPatterns`

### API サーバー

- `apps/cli/src/server/app.ts` で Hono アプリ定義
- `createApp(db)` で DB を注入
- ルート: `apps/cli/src/server/routes/` 配下

### フロントエンド

- ダッシュボード: `apps/frontend/src/components/app/dashboard.tsx`
- ADAS API 接続: `apps/frontend/src/hooks/use-adas-api.ts` のヘルパーを使用
- shadcn/ui コンポーネント追加は `apps/frontend` ディレクトリで実行
