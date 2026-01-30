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

### サマリ生成

- `apps/cli/src/summarizer/generator.ts` の `buildActivityText()` でサマリ内容を構築
- 含まれるデータ: 音声/メモ、Slack、Claude Code、タスク (承認済み)、学び
- タスクと学びはサマリに自動で含まれる

### フィードバックループ

- **動的 few-shot 挿入**: `apps/cli/src/feedback-injector.ts`
- **プロンプト自動改善**: `apps/cli/src/server/routes/prompt-improvements.ts`
- **プロフィール提案**: `apps/cli/src/server/routes/profile.ts`
- 詳細: [docs/feedback-loop.md](docs/feedback-loop.md)

### タスク抽出

- **API**: `apps/cli/src/server/routes/tasks.ts`
- **プロンプト**: `packages/core/prompts/task-extract.md`
- **フロントエンド**: `apps/frontend/src/components/app/tasks-panel.tsx`

**対応ソース**:
| ソース | エンドポイント | 必要な設定 |
|--------|---------------|-----------|
| Slack | `POST /api/tasks/extract` | `slack.userId` |
| GitHub Items | `POST /api/tasks/extract-github` | `github.username` |
| GitHub Comments | `POST /api/tasks/extract-github-comments` | `github.username` |
| Memos | `POST /api/tasks/extract-memos` | - |

**フィードバックループ**:
- 承認/却下履歴から few-shot examples を自動構築
- 却下理由も学習に活用
- プロンプト改善案はタスクとして登録 (`sourceType: "prompt-improvement"`)

### ユーザープロフィール

- **DB テーブル**: `user_profile` (単一レコード)、`profile_suggestions` (提案)
- **API**: `apps/cli/src/server/routes/profile.ts`
- **フロントエンド**: `apps/frontend/src/components/app/profile-panel.tsx`
- **Worker**: `apps/worker/src/routes/analyze-profile.ts` (提案生成)
- 学び抽出時にプロフィール情報を参照して精度向上 (`apps/cli/src/claude-code/extractor.ts`)

### フロントエンド

- ダッシュボード: `apps/frontend/src/components/app/dashboard.tsx`
- ADAS API 接続: `apps/frontend/src/hooks/use-adas-api.ts` のヘルパーを使用
- shadcn/ui コンポーネント追加は `apps/frontend` ディレクトリで実行

#### UI/UX 実装方針

**モーダルのキーボードショートカット**:
- OKボタン(送信/確定)は `Command+Enter` (Mac) / `Ctrl+Enter` (Windows) で実行可能にする
- `useEffect` で `window` の `keydown` イベントをリッスン
- 実装例: `apps/frontend/src/components/app/feedback-dialog.tsx`

```tsx
useEffect(() => {
  if (!open) return;

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
});
```

### Vite 開発サーバーがハングする場合

`bun run dev` でハングする場合、Vite キャッシュをクリア:

```bash
rm -rf apps/frontend/node_modules/.vite
bun run dev
```

それでもダメな場合は依存関係を再インストール:

```bash
rm -rf node_modules bun.lock
bun install
bun run dev
```
