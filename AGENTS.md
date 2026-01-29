# AGENTS.md

AI アシスタント向け共通ドキュメント。常に日本語で回答してください。

## プロジェクト概要

**All Day Activity Summarizer (ADAS)** - PCの音声入出力を1日中監視し、Whisper(ローカル)で文字起こし、Claude APIで要約するアプリケーション。CLIツール + Web UIダッシュボード構成。

| カテゴリ | 技術 |
|---------|------|
| 音声キャプチャ | ブラウザ MediaRecorder API(Web UI 経由) |
| 文字起こし | whisper.cpp(ローカル実行) |
| 要約 | @anthropic-ai/claude-agent-sdk(Claude API) |
| 文字起こし評価 | @anthropic-ai/claude-agent-sdk(haiku, ハルシネーション検出) |
| DB | SQLite(bun:sqlite + Drizzle ORM) |
| CLI | Commander.js + Bun |
| APIサーバー | Hono + @hono/node-server |
| フロントエンド | React 19 + Vite + Tailwind CSS 4 + shadcn/ui |
| テスト | Playwright + Storybook |
| ツール | Bun, Biome, Lefthook |

## コマンド

```bash
# CLI
bun run cli -- setup         # WhisperX + whisper.cpp セットアップ
bun run cli -- worker        # Worker のみ起動
bun run cli -- serve         # APIサーバー + ブラウザ録音 + 要約スケジューラ
bun run cli -- transcribe    # 文字起こし
bun run cli -- interpret     # AI 解釈(interpretedText 生成)
bun run cli -- summarize     # 要約生成
bun run cli -- enroll        # 話者登録

# 開発
bun run dev              # フロントエンド :5173

# 品質チェック
bun run lint             # Biome チェック
bun run lint:fix         # 自動修正

# 型チェック
npx tsc --noEmit -p apps/cli/tsconfig.json
npx tsc --noEmit -p apps/worker/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json

# shadcn/ui 追加(apps/frontend で実行)
cd apps/frontend && bunx shadcn add <component>
```

## モノレポ構造

```
apps/
├── cli/                # CLIツール(録音、設定、APIサーバー)
│   └── src/
│       ├── index.ts    # エントリポイント(Commander.js)
│       ├── config.ts   # 設定管理(~/.adas/config.json)
│       ├── commands/   # transcribe, interpret, summarize, serve, setup, worker, enroll
│       ├── audio/      # 音声チャンク処理
│       ├── whisper/    # WhisperXクライアント + 評価 + 話者管理
│       ├── interpreter/ # AI 解釈共通ロジック(interpretSegments)
│       ├── summarizer/ # 要約クライアント + スケジューラ
│       ├── server/     # Hono APIサーバー + ルート定義
│       └── utils/      # 日付ユーティリティ
├── worker/             # RPC Worker(WhisperX + Claude 実行、別マシンデプロイ可)
│   └── src/
│       ├── app.ts      # Hono アプリ(createWorkerApp)
│       ├── index.ts    # サーバー起動
│       └── routes/     # transcribe, summarize, evaluate, health
└── frontend/           # React SPAダッシュボード
    └── src/
        ├── components/
        │   ├── ui/     # shadcn/uiコンポーネント
        │   └── app/    # dashboard, timeline, memo, evaluator-log, speaker-assign
        ├── hooks/      # use-transcriptions, use-summaries, use-memos, etc.
        └── types/      # 型定義

packages/
├── core/               # CLI/Worker 共有ロジック
│   └── src/
│       ├── index.ts    # re-export(runClaude, getScriptPath)
│       ├── claude-runner.ts  # Claude Code CLI 呼び出し
│       ├── scripts.ts  # Python スクリプトパス解決
│       └── scripts/    # whisperx_transcribe.py, enroll_speaker.py
├── types/              # 共有型定義
│   └── src/
│       ├── index.ts    # エクスポート集約
│       ├── adas.ts     # RPC型、TranscriptionSegment, Summary, etc.
│       ├── api.ts      # ApiResponse, ApiError, Post
│       └── env.ts      # Env インターフェース
└── db/                 # Drizzleスキーマ + DB接続
    └── src/
        ├── index.ts    # createDatabase(bun:sqlite + Drizzle)
        └── schema.ts   # テーブル定義
```

### ワークスペース依存関係

```
@repo/types  <── @repo/core <── apps/cli
@repo/db     <──────────────── apps/cli
@repo/types  <── @repo/core <── apps/worker
@repo/types  <──────────────── apps/frontend
```

CLI と Worker の間に直接依存はなく、HTTP(RPC)で通信。

### DBスキーマ

| テーブル | カラム |
|---------|--------|
| `transcription_segments` | id, date, start_time, end_time, audio_source, audio_file_path, transcription, language, confidence, speaker, interpreted_text, created_at |
| `summaries` | id, date, period_start, period_end, summary_type(pomodoro/hourly/daily), content, segment_ids, model, created_at |
| `memos` | id, date, content, created_at |
| `evaluator_logs` | id, date, audio_file_path, transcription_text, judgment, confidence, reason, suggested_pattern, pattern_applied, created_at |

### APIエンドポイント

**CLI APIサーバー(:3001)**

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/health` | ヘルスチェック |
| GET | `/api/status` | 録音状態・本日の統計 |
| GET | `/api/transcriptions?date=` | 文字起こし一覧 |
| GET | `/api/summaries?date=&type=` | 要約一覧 |
| POST | `/api/summaries/generate` | 手動要約トリガー |
| GET | `/api/memos?date=` | メモ一覧 |
| POST | `/api/memos` | メモ作成 |
| GET | `/api/evaluator-logs?date=` | 評価ログ一覧 |
| GET | `/api/speakers` | 登録済み話者一覧 |
| GET | `/api/speakers/unknown` | 未知話者一覧 |

**Worker RPCサーバー(:3100)**

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/rpc/health` | ヘルスチェック |
| POST | `/rpc/transcribe` | WhisperX 文字起こし |
| POST | `/rpc/summarize` | Claude 要約実行 |
| POST | `/rpc/interpret` | AI テキスト解釈 |
| POST | `/rpc/evaluate` | ハルシネーション評価 |

## 開発ガイドライン

### テスト

- 機能実装時は対応するテストも実装・更新
- 単体テスト: `*.test.ts(x)` を対象ファイルと同じディレクトリに配置
- E2E: `apps/frontend/e2e/` に配置

### Lint (Biome)

警告レベルのルール(即時対応不要):
- `noExcessiveCognitiveComplexity`: 複雑度 15 超過
- `noNonNullAssertion`: 非 null アサーション使用
- `useExhaustiveDependencies`: 依存配列不足

### DB注意事項

- **bun:sqlite** を使用(better-sqlite3はBun未サポート)
- Drizzle ORMドライバは `drizzle-orm/bun-sqlite`
- データは `~/.adas/adas.db` に保存

## コードレビューの思想

### 評価の観点

1. **SRP**: クラス/関数の責任分離
2. **Code for Humans**: 可読性、保守性
3. **KISS**: シンプルで明確な実装
4. **CoC**: プロジェクト規約への準拠
5. **TypeScript 型安全性**: 適切な型定義、any の排除

### トレードオフの優先順位

```
セキュリティ > 保守性 > パフォーマンス > コード美観
```

### SRP vs KISS

- 50 行以下 -> KISS 優先
- 50-100 行 -> 明確に異なる責任がある場合のみ分割
- 100 行以上 -> SRP 優先

## 重要な制約事項

- **TypeScript strict モード必須**: Hono RPC に必要
- **CSS ファイルは Biome 対象外**: Tailwind ディレクティブとの互換性のため
- **shadcn/ui は apps/frontend で実行**: ルートでは正しく動作しない
- **bun:sqlite 必須**: better-sqlite3 は Bun ランタイムで未サポート
