# All Day Activity Summarizer (ADAS)

PCの音声入出力を1日中監視し、WhisperX(ローカル)で文字起こし + 話者識別、Claude Code CLIで要約するアプリケーション。
CLIツール + Worker(文字起こし/評価) + Web UIダッシュボードの3層構成。

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

- ffmpeg による音声キャプチャ(macOS: avfoundation / Linux: PulseAudio)
- WhisperX(ローカル)による文字起こし + 話者ダイアライゼーション
- Claude(sonnet)による音声認識テキストのAI解釈(読みやすい日本語への整形)
- Claude Code CLI による時間単位(ポモドーロ/1時間)/日次要約
- Claude Code CLI(haiku)によるハルシネーション自動評価 + パターン自動追加
- 話者登録(声紋埋め込み) + 未知話者の名前割り当て
- SQLite(bun:sqlite + Drizzle ORM)によるデータ永続化
- Hono ローカルAPIサーバー + メモ機能
- React + shadcn/ui ダッシュボードUI

## 技術スタック

| 機能 | 技術 |
|------|------|
| 音声キャプチャ | ffmpeg(macOS avfoundation / Linux PulseAudio) |
| 文字起こし | WhisperX(ローカル、話者ダイアライゼーション対応) |
| 要約/評価 | Claude Code CLI(`claude -p`) |
| DB | SQLite(bun:sqlite + Drizzle ORM) |
| CLI | Commander.js + Bun |
| Worker | Hono + Bun.serve(WhisperX/Claude 実行サーバー) |
| APIサーバー | Hono + @hono/node-server |
| UI | React 19 + Vite + Tailwind CSS 4 + shadcn/ui |
| 品質管理 | TypeScript strict + Biome + Lefthook |

## セットアップ

### 前提条件

| ソフトウェア | 用途 | 必須 |
|------------|------|------|
| **Bun** v1.1.44+ | ランタイム・パッケージ管理 | Yes |
| **ffmpeg** | 音声キャプチャ | Yes |
| **Python 3.11-3.13** + **venv** | WhisperX 実行環境 | Yes |
| **cmake** + **g++** (or clang) | whisper.cpp ビルド(fallback) | Yes |
| **git** | whisper.cpp クローン | Yes |
| **Claude Code CLI** (`claude`) | 要約・評価実行 | Yes |
| **PulseAudio** | 音声ソース(Linux/WSL2) | Linux のみ |
| **HuggingFace トークン** | 話者ダイアライゼーション | 話者識別を使う場合 |

### システムパッケージのインストール

```bash
# === macOS ===
brew install ffmpeg cmake python@3.12

# === Ubuntu / Debian / WSL2 ===
sudo apt update
sudo apt install -y \
  ffmpeg \
  cmake g++ git \
  python3 python3-venv python3-pip \
  pulseaudio

# Python 3.12 の場合(Ubuntu 24.04+)
# sudo apt install -y python3.12-venv

# === Bun(未インストールの場合) ===
curl -fsSL https://bun.sh/install | bash

# === Claude Code CLI(Native インストール推奨) ===
# https://docs.anthropic.com/en/docs/claude-code/overview を参照
# macOS
brew install claude-code
# Linux
sudo snap install claude-code --classic
```

### インストール

```bash
# 依存関係のインストール
bun install

# WhisperX + whisper.cpp のセットアップ
bun run cli -- setup

# 動作確認
bun run cli -- --help
```

### 環境変数

```bash
# HuggingFace トークン(話者ダイアライゼーションに必要)
export HF_TOKEN=hf_...

# ~/.adas/config.json の whisper.hfToken にも設定可能
```

## CLIコマンド

```bash
# 初期セットアップ(WhisperX venv + whisper.cpp fallback)
bun run cli -- setup

# 全機能一括起動(Worker + 録音 + 文字起こし + 要約 + APIサーバー)
bun run cli -- all
bun run cli -- all -s <source> -p 8080 --worker-port 3100

# Worker のみ起動(別マシンで実行可能)
bun run cli -- worker
bun run cli -- worker -p 3100

# 録音(Worker が起動済みである必要あり)
bun run cli -- record
bun run cli -- record --list-sources       # 音声ソース一覧
bun run cli -- record -s <source>          # ソース指定

# 文字起こし
bun run cli -- transcribe                  # 今日の録音を文字起こし
bun run cli -- transcribe -d 2025-01-01    # 日付指定
bun run cli -- transcribe --watch          # 録音完了を監視して自動実行

# AI 解釈(interpretedText 生成)
bun run cli -- interpret                   # 今日の未解釈セグメント
bun run cli -- interpret -d 2025-01-01     # 日付指定
bun run cli -- interpret --all             # 全日付の未解釈セグメント
bun run cli -- interpret --all --force     # 全セグメントを再解釈

# 要約生成
bun run cli -- summarize                   # 全時間帯の要約
bun run cli -- summarize --hour 14         # 特定時間の要約
bun run cli -- summarize --daily           # 日次要約

# APIサーバーのみ
bun run cli -- serve                       # デフォルト :3001
bun run cli -- serve -p 8080

# 話者登録
bun run cli -- enroll --name "Alice" --audio sample.wav
bun run cli -- enroll --list               # 登録済み話者一覧
bun run cli -- enroll --remove "Alice"     # 話者削除
bun run cli -- enroll --assign             # 未知話者に名前を割り当て
```

### 一括起動(推奨)

```bash
bun run cli -- all
```

`all` コマンドは以下を同時起動:
1. Worker サーバー(子プロセス、WhisperX + Claude 実行)
2. 音声録音(5分チャンク)
3. 録音完了時の自動文字起こし(Worker 経由)
4. 定期要約スケジューラ(ポモドーロ30分 + 1時間ごと + 日終了時)
5. ローカルAPIサーバー

## APIエンドポイント

### CLI APIサーバー(:3001)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/health` | ヘルスチェック |
| GET | `/api/status` | 録音状態・本日の統計 |
| GET | `/api/transcriptions?date=YYYY-MM-DD` | 文字起こし一覧 |
| GET | `/api/summaries?date=YYYY-MM-DD&type=pomodoro\|hourly\|daily` | 要約一覧 |
| POST | `/api/summaries/generate` | 手動要約トリガー |
| GET | `/api/memos?date=YYYY-MM-DD` | メモ一覧 |
| POST | `/api/memos` | メモ作成 |
| GET | `/api/evaluator-logs?date=YYYY-MM-DD` | 評価ログ一覧 |
| GET | `/api/speakers` | 登録済み話者一覧 |
| GET | `/api/speakers/unknown` | 未知話者一覧 |

### Worker RPCサーバー(:3100)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/rpc/health` | ヘルスチェック(WhisperX/Claude 状態) |
| POST | `/rpc/transcribe` | WhisperX 文字起こし(multipart/form-data) |
| POST | `/rpc/summarize` | Claude 要約実行 |
| POST | `/rpc/interpret` | AI テキスト解釈 |
| POST | `/rpc/evaluate` | ハルシネーション評価 |

## アーキテクチャ

### モノレポ構造

```
apps/
├── cli/                  # CLIツール(録音、設定、APIサーバー)
│   └── src/
│       ├── index.ts      # エントリポイント(Commander.js)
│       ├── config.ts     # 設定管理(~/.adas/config.json)
│       ├── commands/     # record, transcribe, interpret, summarize, serve, setup, all, worker, enroll
│       ├── audio/        # ffmpeg音声キャプチャ + チャンク処理
│       ├── whisper/      # WhisperXクライアント + 評価 + 話者管理
│       ├── interpreter/  # AI 解釈共通ロジック(interpretSegments)
│       ├── summarizer/   # 要約クライアント + スケジューラ
│       ├── server/       # Hono APIサーバー + ルート定義
│       └── utils/        # 日付ユーティリティ
├── worker/               # RPC Worker(WhisperX + Claude 実行)
│   └── src/
│       ├── app.ts        # Hono アプリ(createWorkerApp)
│       ├── index.ts      # サーバー起動
│       └── routes/       # transcribe, summarize, evaluate, health
└── frontend/             # React SPAダッシュボード
    └── src/
        ├── components/
        │   ├── ui/       # shadcn/uiコンポーネント
        │   └── app/      # dashboard, timeline, memo, evaluator-log, speaker-assign
        ├── hooks/        # use-transcriptions, use-summaries, use-memos, etc.
        └── types/        # 型定義

packages/
├── core/                 # CLI/Worker 共有ロジック
│   └── src/
│       ├── index.ts      # re-export(runClaude, getScriptPath)
│       ├── claude-runner.ts  # Claude Code CLI 呼び出し
│       ├── scripts.ts    # Python スクリプトパス解決
│       └── scripts/      # whisperx_transcribe.py, enroll_speaker.py
├── types/                # 共有型定義
│   └── src/
│       ├── index.ts
│       ├── adas.ts       # RPC型、TranscriptionSegment, Summary, etc.
│       ├── api.ts
│       └── env.ts
└── db/                   # Drizzleスキーマ + DB接続
    └── src/
        ├── index.ts      # createDatabase(bun:sqlite + Drizzle)
        └── schema.ts     # テーブル定義
```

### ワークスペース依存関係

```
@repo/types  <── @repo/core <── apps/cli
@repo/db     <──────────────── apps/cli
@repo/types  <── @repo/core <── apps/worker
@repo/types  <──────────────── apps/frontend
```

CLI と Worker の間に直接依存はなく、HTTP(RPC)で通信。Worker は別マシンにデプロイ可能。

### DBスキーマ

| テーブル | カラム |
|---------|--------|
| `transcription_segments` | id, date, start_time, end_time, audio_source, audio_file_path, transcription, language, confidence, speaker, interpreted_text, created_at |
| `summaries` | id, date, period_start, period_end, summary_type(pomodoro/hourly/daily), content, segment_ids, model, created_at |
| `memos` | id, date, content, created_at |
| `evaluator_logs` | id, date, audio_file_path, transcription_text, judgment, confidence, reason, suggested_pattern, pattern_applied, created_at |

### データフロー

```
マイク → ffmpeg → WAV(5分チャンク)
  → Worker(WhisperX) → テキスト + 話者ラベル → SQLite
  → Worker(Claude sonnet) → AI 解釈(interpretedText)
  → Worker(Claude haiku) → ハルシネーション評価 → パターン自動追加
  → Worker(Claude) → ポモドーロ/時間/日次要約
  → Hono API → React ダッシュボード
```

### 設定ファイル

デフォルトの設定は `~/.adas/config.json` に保存:

```json
{
  "recordingsDir": "~/.adas/recordings",
  "dbPath": "~/.adas/adas.db",
  "whisper": {
    "modelName": "ggml-large-v3-turbo-q5_0.bin",
    "language": "ja",
    "engine": "whisperx",
    "hfToken": "hf_..."
  },
  "audio": {
    "sampleRate": 16000,
    "channels": 1,
    "chunkDurationMinutes": 5
  },
  "server": { "port": 3001 },
  "evaluator": {
    "enabled": true,
    "autoApplyPatterns": true
  },
  "worker": {
    "url": "http://localhost:3100",
    "timeout": 120000
  }
}
```

## 開発ワークフロー

### 開発コマンド

```bash
# フロントエンド開発サーバー(:5173)
bun run dev

# プロダクションビルド
bun run build
```

### 品質管理

```bash
# Biomeチェック
bun run lint

# 自動修正
bun run lint:fix

# 型チェック
npx tsc --noEmit -p apps/cli/tsconfig.json
npx tsc --noEmit -p apps/worker/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json
```

### shadcn/uiコンポーネント追加

```bash
cd apps/frontend && bunx shadcn add <component>
```

### Git Hooks(Lefthook)

- **pre-commit**: Biomeでリント・フォーマット(自動修正)

## トラブルシューティング

### Worker に接続できない

```bash
# Worker が起動しているか確認
curl http://localhost:3100/rpc/health

# Worker を手動起動
bun run cli -- worker
```

### ポートが既に使用されている

```bash
# LISTEN しているプロセスを確認
lsof -i :3001 -sTCP:LISTEN
lsof -i :3100 -sTCP:LISTEN

# プロセスを停止
kill <PID>
```

### WhisperX のセットアップに失敗する

```bash
# "ensurepip is not available" エラーの場合
# → python3-venv パッケージが必要
sudo apt install python3-venv
# Python 3.12 の場合
sudo apt install python3.12-venv

# "cmake: not found" エラーの場合
sudo apt install cmake g++

# Python バージョンを確認(3.11-3.13 が必要)
python3 --version

# venv を再作成
rm -rf ~/.adas/whisperx-venv
bun run cli -- setup
```

### HuggingFace トークン関連

話者ダイアライゼーションには HuggingFace トークンが必要:

1. https://huggingface.co/settings/tokens でトークンを取得
2. pyannote のモデル利用規約に同意(https://huggingface.co/pyannote/speaker-diarization-3.1)
3. `~/.adas/config.json` の `whisper.hfToken` に設定、または `HF_TOKEN` 環境変数をセット

### キャッシュのクリア

```bash
rm -rf node_modules bun.lock
bun install
```

## ライセンス

MIT License
