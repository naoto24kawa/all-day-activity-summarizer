# AGENTS.md

AI アシスタント向け共通ドキュメント。常に日本語で回答してください。

## プロジェクト概要

**All Day Activity Summarizer (ADAS)** - PCの音声入出力を1日中監視し、Whisper(ローカル)で文字起こし、Claude APIで要約するアプリケーション。CLIツール + Web UIダッシュボード構成。

| カテゴリ | 技術 |
|---------|------|
| 音声キャプチャ | ffmpeg + PulseAudio(WSL2) |
| 文字起こし | whisper.cpp(ローカル実行) |
| 要約 | @anthropic-ai/sdk(Claude API) |
| DB | SQLite(bun:sqlite + Drizzle ORM) |
| CLI | Commander.js + Bun |
| APIサーバー | Hono + @hono/node-server |
| フロントエンド | React 19 + Vite + Tailwind CSS 4 + shadcn/ui |
| テスト | Playwright + Storybook |
| ツール | Bun, Biome, Lefthook |

## コマンド

```bash
# CLI
bun run cli -- setup         # whisper.cppセットアップ
bun run cli -- all           # 全機能一括起動
bun run cli -- record        # 録音のみ
bun run cli -- transcribe    # 文字起こし
bun run cli -- summarize     # 要約生成
bun run cli -- serve         # APIサーバー(:3001)

# 開発(別ターミナルで実行)
bun run dev              # フロントエンド :5173
bun run dev:backend      # バックエンド :8787

# 品質チェック
bun run lint             # Biome チェック
bun run lint:fix         # 自動修正
bun run test             # E2E テスト
bun run storybook        # Storybook :6006

# shadcn/ui 追加(apps/frontend で実行)
cd apps/frontend && bunx shadcn add <component>
```

## モノレポ構造

```
apps/
├── cli/                # CLIツール(音声キャプチャ、文字起こし、要約)
│   └── src/
│       ├── index.ts    # エントリポイント(Commander.js)
│       ├── config.ts   # 設定管理(~/.adas/config.json)
│       ├── commands/   # record, transcribe, summarize, serve, setup, all
│       ├── audio/      # ffmpeg音声キャプチャ
│       ├── whisper/    # whisper.cppラッパー + セットアップ
│       ├── summarizer/ # Claude API要約 + スケジューラ
│       ├── server/     # Hono APIサーバー + ルート定義
│       └── utils/      # 共通ユーティリティ(date.ts)
├── frontend/           # React SPAダッシュボード
│   └── src/
│       ├── components/
│       │   ├── ui/     # shadcn/uiコンポーネント
│       │   └── app/    # dashboard, status-panel, timeline, etc.
│       ├── hooks/      # use-transcriptions, use-summaries, use-status
│       └── lib/        # api-client, utils
└── backend/            # Hono API(Cloudflare Workers)
    └── src/index.ts    # エントリポイント(AppType export)

packages/
├── types/              # 共有型定義
│   └── src/
│       ├── index.ts    # エクスポート集約
│       ├── adas.ts     # TranscriptionSegment, Summary, StatusResponse, etc.
│       ├── api.ts      # ApiResponse, ApiError, Post
│       └── env.ts      # Env インターフェース
└── db/                 # Drizzleスキーマ + DB接続
    └── src/
        ├── index.ts    # createDatabase(bun:sqlite + Drizzle)
        └── schema.ts   # transcription_segments, summaries テーブル
```

### ワークスペース依存関係

- **@repo/cli** -> `@repo/types`, `@repo/db`
- **@repo/frontend** -> `@repo/types`, `@repo/backend`(AppType参照)
- **@repo/backend** -> `@repo/types`
- **@repo/db** -> `drizzle-orm`(bun:sqlite)

### DBスキーマ

```
transcription_segments: id, date, start_time, end_time, audio_source,
  audio_file_path, transcription, language, confidence, created_at

summaries: id, date, period_start, period_end, summary_type(hourly|daily),
  content, segment_ids, model, created_at
```

### APIエンドポイント(CLI serve)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/status` | 録音状態・本日の統計 |
| GET | `/api/transcriptions?date=` | 文字起こし一覧 |
| GET | `/api/summaries?date=&type=` | 要約一覧 |
| POST | `/api/summaries/generate` | 手動要約トリガー |

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
