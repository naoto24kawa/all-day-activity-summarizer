# All Day Activity Summarizer (ADAS)

PCの音声入出力を1日中監視し、Whisper(ローカル)で文字起こし、Claude APIで要約するアプリケーション。
CLIツール + Web UIダッシュボードの構成。

## 目次

- [概要](#概要)
- [技術スタック](#技術スタック)
- [セットアップ](#セットアップ)
- [CLIコマンド](#cliコマンド)
- [APIエンドポイント](#apiエンドポイント)
- [アーキテクチャ](#アーキテクチャ)
- [開発ワークフロー](#開発ワークフロー)
- [トラブルシューティング](#トラブルシューティング)

## 概要

**主な機能:**

- ffmpeg + PulseAudio による音声キャプチャ(マイク + システム音声)
- whisper.cpp(ローカル)による文字起こし
- Claude API(@anthropic-ai/sdk)による時間単位/日次要約
- SQLite(bun:sqlite + Drizzle ORM)によるデータ永続化
- Hono ローカルAPIサーバー
- React + shadcn/ui ダッシュボードUI

## 技術スタック

| 機能 | 技術 |
|------|------|
| 音声キャプチャ | ffmpeg + PulseAudio(WSL2) |
| 文字起こし | whisper.cpp(ローカル実行) |
| 要約 | @anthropic-ai/sdk(Claude API) |
| DB | SQLite(bun:sqlite + Drizzle ORM) |
| CLI | Commander.js + Bun |
| API | Hono + @hono/node-server |
| UI | React 19 + Vite + Tailwind CSS 4 + shadcn/ui |
| 品質管理 | TypeScript strict + Biome + Playwright |

## セットアップ

### 前提条件

- **Bun** v1.1.44以上
- **ffmpeg** (PulseAudioサポート付き)
- **cmake** + **g++** (whisper.cppビルド用)

```bash
# Bunのインストール(未インストールの場合)
curl -fsSL https://bun.sh/install | bash

# Ubuntu/WSL2での前提パッケージ
sudo apt install ffmpeg pulseaudio cmake g++
```

### インストール

```bash
# 依存関係のインストール
bun install

# whisper.cppのセットアップ(クローン、ビルド、モデルDL)
bun run cli -- setup

# 動作確認
bun run cli -- --help
```

### 環境変数

```bash
# Claude API要約に必要
export ANTHROPIC_API_KEY=sk-ant-...
```

## CLIコマンド

```bash
# 初期セットアップ(whisper.cppビルド + モデルDL)
bun run cli -- setup

# 全機能一括起動(録音 + 文字起こし + 要約 + APIサーバー)
bun run cli -- all

# 個別起動
bun run cli -- record                     # 録音のみ
bun run cli -- record --list-sources      # PulseAudioソース一覧
bun run cli -- record -s <source>         # ソース指定で録音
bun run cli -- transcribe                 # 今日の録音を文字起こし
bun run cli -- transcribe -d 2025-01-01   # 日付指定
bun run cli -- transcribe --watch         # 録音完了を監視して自動文字起こし
bun run cli -- summarize                  # 全時間帯の要約生成
bun run cli -- summarize --hour 14        # 特定時間の要約
bun run cli -- summarize --daily          # 日次要約
bun run cli -- serve                      # APIサーバー起動(デフォルト:3001)
bun run cli -- serve -p 8080             # ポート指定
```

### 一括起動

```bash
# 全サービスを一括起動(推奨)
bun run cli -- all
# オプション: ソース指定 + ポート指定
bun run cli -- all -s <source> -p 8080
```

`all` コマンドは以下を同時起動:
1. 音声録音(5分チャンク)
2. 録音完了時の自動文字起こし
3. 定期要約スケジューラ(1時間ごと + 日終了時)
4. ローカルAPIサーバー

## APIエンドポイント

APIサーバー起動後、以下のエンドポイントが利用可能:

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/status` | 録音状態・本日の統計 |
| GET | `/api/transcriptions?date=YYYY-MM-DD` | 文字起こし一覧 |
| GET | `/api/summaries?date=YYYY-MM-DD&type=hourly\|daily` | 要約一覧 |
| POST | `/api/summaries/generate` | 手動要約トリガー |

## アーキテクチャ

### モノレポ構造

```
apps/
├── cli/                  # CLIツール(音声キャプチャ、文字起こし、要約)
│   └── src/
│       ├── index.ts      # エントリポイント(Commander.js)
│       ├── config.ts     # 設定管理(~/.adas/config.json)
│       ├── commands/     # record, transcribe, summarize, serve, setup, all
│       ├── audio/        # ffmpeg音声キャプチャ
│       ├── whisper/      # whisper.cppラッパー + セットアップ
│       ├── summarizer/   # Claude API要約 + スケジューラ
│       ├── server/       # Hono APIサーバー + ルート定義
│       └── utils/        # 共通ユーティリティ
├── frontend/             # React SPAダッシュボード
│   └── src/
│       ├── components/
│       │   ├── ui/       # shadcn/uiコンポーネント
│       │   └── app/      # dashboard, status-panel, timeline, etc.
│       ├── hooks/        # use-transcriptions, use-summaries, use-status
│       └── lib/          # api-client, utils
└── backend/              # Hono API(Cloudflare Workers)

packages/
├── types/                # 共有型定義(TranscriptionSegment, Summary, etc.)
│   └── src/
│       ├── index.ts
│       ├── adas.ts       # ADAS固有の型
│       ├── api.ts
│       └── env.ts
└── db/                   # Drizzleスキーマ + DB接続
    └── src/
        ├── index.ts      # createDatabase(bun:sqlite + Drizzle)
        └── schema.ts     # transcription_segments, summaries
```

### DBスキーマ

```sql
transcription_segments:
  id, date, start_time, end_time, audio_source, audio_file_path,
  transcription, language, confidence, created_at

summaries:
  id, date, period_start, period_end, summary_type(hourly|daily),
  content, segment_ids, model, created_at
```

### データフロー

```
PulseAudio → ffmpeg → WAV(5分チャンク)
  → whisper.cpp → テキスト → SQLite
  → Claude API → 時間要約 → 日次要約
  → Hono API → React ダッシュボード
```

### ワークスペース依存関係

- **@repo/cli** -> `@repo/types`, `@repo/db`
- **@repo/frontend** -> `@repo/types`, `@repo/backend`(AppType参照)
- **@repo/backend** -> `@repo/types`
- **@repo/db** -> `drizzle-orm`(bun:sqlite)

### 設定ファイル

デフォルトの設定は `~/.adas/config.json` に保存:

```json
{
  "recordingsDir": "~/.adas/recordings",
  "dbPath": "~/.adas/adas.db",
  "whisper": {
    "modelName": "base",
    "language": "ja"
  },
  "audio": {
    "sampleRate": 16000,
    "channels": 1,
    "chunkDurationMinutes": 5
  },
  "server": {
    "port": 3001
  }
}
```

## 開発ワークフロー

### 開発コマンド

```bash
# フロントエンド開発サーバー(:5173)
bun run dev

# バックエンド開発サーバー(:8787)
bun run dev:backend

# プロダクションビルド
bun run build
```

### 品質管理

```bash
# Biomeチェック
bun run lint

# 自動修正
bun run lint:fix

# E2Eテスト
bun run test

# 全検証(lint + test + build)
bun run validate

# Storybook(:6006)
bun run storybook
```

### shadcn/uiコンポーネント追加

```bash
cd apps/frontend && bunx shadcn add <component>
```

### Git Hooks(Lefthook)

- **pre-commit**: Biomeでリント・フォーマット(自動修正)
- **pre-push**: リントチェック、テスト実行、ビルド確認

## トラブルシューティング

### PulseAudioソースが見つからない(WSL2)

```bash
# PulseAudioサービス起動
pulseaudio --start

# ソース一覧を確認
bun run cli -- record --list-sources
```

### whisper.cppのビルドに失敗する

```bash
# 必要なパッケージ
sudo apt install cmake g++ git

# 再セットアップ
rm -rf ~/.adas/whisper.cpp
bun run cli -- setup
```

### ポートが既に使用されている

```bash
lsof -i :3001
kill -9 <PID>
```

### キャッシュのクリア

```bash
rm -rf node_modules bun.lockb
bun install
```

## ライセンス

MIT License
