# All Day Activity Summarizer (ADAS)

PCの音声入出力を1日中監視し、WhisperX(ローカル)で文字起こし + 話者識別、Claude Code CLIで要約するアプリケーション。
CLIツール + Worker(文字起こし/評価) + Web UIダッシュボードの3層構成。

## 目次

- [概要](#概要)
- [技術スタック](#技術スタック)
- [セットアップ](#セットアップ)
- [CLIコマンド](#cliコマンド)
- [APIエンドポイント](#apiエンドポイント)
- [外部サービス統合](#外部サービス統合)
- [アーキテクチャ](#アーキテクチャ)
- [開発ワークフロー](#開発ワークフロー)
- [トラブルシューティング](#トラブルシューティング)

## 概要

**主な機能:**

- ブラウザベースの音声録音(Web UI から操作)
- WhisperX(ローカル)による文字起こし + 話者ダイアライゼーション
- Claude(sonnet)による音声認識テキストのAI解釈(読みやすい日本語への整形)
- Claude Code CLI による時間単位(ポモドーロ/1時間)/日次要約
- Claude Code CLI(haiku)によるハルシネーション自動評価 + パターン自動追加
- 話者登録(声紋埋め込み) + 未知話者の名前割り当て
- SQLite(bun:sqlite + Drizzle ORM)によるデータ永続化
- Hono ローカルAPIサーバー + メモ機能
- React + shadcn/ui ダッシュボードUI
- **Slack 統合**: メンション・チャンネル・DM の自動取得
- **GitHub 統合**: 自分に関連する Issue/PR/レビューリクエストの自動取得
- **Claude Code 統合**: セッション履歴の自動取得・表示

## 技術スタック

| 機能 | 技術 |
|------|------|
| 音声キャプチャ | ブラウザ MediaRecorder API(Web UI 経由) |
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
| **Python 3.11-3.13** + **venv** | WhisperX 実行環境 | Yes |
| **cmake** + **g++** (or clang) | whisper.cpp ビルド(fallback) | Yes |
| **git** | whisper.cpp クローン | Yes |
| **Claude Code CLI** (`claude`) | 要約・評価実行 | Yes |
| **HuggingFace トークン** | 話者ダイアライゼーション | 話者識別を使う場合 |

### システムパッケージのインストール

```bash
# === macOS ===
brew install cmake python@3.12

# === Ubuntu / Debian / WSL2 ===
sudo apt update
sudo apt install -y \
  cmake g++ git \
  python3 python3-venv python3-pip

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

# Worker のみ起動(別マシンで実行可能)
bun run cli -- worker
bun run cli -- worker -p 3100

# APIサーバー + 録音 + 要約スケジューラ
bun run cli -- serve
bun run cli -- serve -p 8080

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


# 話者登録
bun run cli -- enroll --name "Alice" --audio sample.wav
bun run cli -- enroll --list               # 登録済み話者一覧
bun run cli -- enroll --remove "Alice"     # 話者削除
bun run cli -- enroll --assign             # 未知話者に名前を割り当て
```

### 推奨構成

```bash
# ターミナル1: Worker 起動
bun run cli -- worker

# ターミナル2: serve 起動(APIサーバー + ブラウザ録音 + 要約スケジューラ)
bun run cli -- serve
```

`serve` コマンドは以下を提供:
1. ローカルAPIサーバー(:3001)
2. ブラウザ経由での音声録音(Web UI から操作)
3. 定期要約スケジューラ(ポモドーロ30分 + 1時間ごと + 日終了時)

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
| GET | `/api/slack-messages?date=YYYY-MM-DD` | Slack メッセージ一覧 |
| GET | `/api/slack-messages/unread-count` | Slack 未読カウント |
| GET | `/api/github-items?date=YYYY-MM-DD` | GitHub Issue/PR 一覧 |
| GET | `/api/github-items/unread-count` | GitHub 未読カウント |
| PATCH | `/api/github-items/:id/read` | 既読にする |
| POST | `/api/github-items/mark-all-read` | 一括既読 |
| GET | `/api/github-comments?date=YYYY-MM-DD` | GitHub コメント一覧 |
| GET | `/api/claude-code-sessions?date=YYYY-MM-DD` | Claude Code セッション一覧 |
| POST | `/api/segment-feedbacks` | interpret フィードバック送信 |
| GET | `/api/segment-feedbacks?date=YYYY-MM-DD` | interpret フィードバック取得 |
| POST | `/api/feedbacks/v2` | summarize/evaluate フィードバック送信 |
| GET | `/api/feedbacks/v2?targetType=summary&date=YYYY-MM-DD` | フィードバック取得 |

### Worker RPCサーバー(:3100)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/rpc/health` | ヘルスチェック(WhisperX/Claude 状態) |
| POST | `/rpc/transcribe` | WhisperX 文字起こし(multipart/form-data) |
| POST | `/rpc/summarize` | Claude 要約実行 |
| POST | `/rpc/interpret` | AI テキスト解釈 |
| POST | `/rpc/evaluate` | ハルシネーション評価 |

## 外部サービス統合

ADAS は Slack、GitHub、Claude Code と連携して、日々のアクティビティを一元管理できます。

### GitHub 統合

GitHub CLI (`gh`) を使用して、自分に関連する Issue/PR/レビューリクエストを自動取得します。

#### セットアップ

1. **GitHub CLI のインストールと認証**

```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# 認証
gh auth login
```

2. **設定の有効化**

`~/.adas/config.json` を編集:

```json
{
  "github": {
    "enabled": true,
    "fetchIntervalMinutes": 10,
    "parallelWorkers": 2
  }
}
```

3. **サーバー起動**

```bash
bun run cli -- serve
```

起動時に `[GitHub] Authenticated as <username>` と表示されれば成功です。

#### 取得されるデータ

- **Issues**: 自分にアサインされた Issue
- **Pull Requests**: 自分にアサインされた PR
- **Review Requests**: 自分にレビューリクエストされた PR
- **Comments**: 上記の Issue/PR に付いたコメント・レビュー

#### ダッシュボード

Web UI の「GitHub」タブで、取得したデータを確認できます:
- Issues / PRs / Reviews / Comments のタブ切り替え
- 未読バッジ表示
- 既読管理(個別・一括)
- 外部リンクからGitHubへ直接アクセス

### Slack 統合

Slack のメンション・チャンネル・DM・キーワードを自動取得します(xoxc/xoxd トークン使用)。

#### トークンの取得方法

1. Slack Web アプリ (https://app.slack.com) をブラウザで開く
2. DevTools を開く (F12 または Cmd+Option+I)
3. Network タブを選択
4. 任意の API リクエストを選択し、Request Headers から以下を取得:
   - `Authorization: Bearer xoxc-...` → `xoxcToken`
   - `Cookie: d=xoxd-...` → `xoxdToken`

#### 設定オプション

`~/.adas/config.json` を編集:

```json
{
  "slack": {
    "enabled": true,
    "xoxcToken": "xoxc-...",
    "xoxdToken": "xoxd-...",
    "userId": "U059Z83SHRD",
    "fetchIntervalMinutes": 5,
    "parallelWorkers": 3,
    "channels": [],
    "excludeChannels": ["*rss*", "*bot*"],
    "mentionGroups": ["team_開発部", "team_プロジェクト*"],
    "watchKeywords": ["*自分の名前*", "*障害*", "*緊急*"]
  }
}
```

| オプション | 説明 | 例 |
|-----------|------|-----|
| `enabled` | Slack 統合を有効化 | `true` |
| `xoxcToken` | Slack xoxc トークン | `"xoxc-..."` |
| `xoxdToken` | Slack xoxd トークン | `"xoxd-..."` |
| `userId` | 自分の Slack ユーザー ID (自分の投稿を除外) | `"U059Z83SHRD"` |
| `fetchIntervalMinutes` | 取得間隔(分) | `5` |
| `parallelWorkers` | 並列ワーカー数 | `3` |
| `channels` | 監視するチャンネル ID (空=全参加チャンネル) | `["C12345678"]` |
| `excludeChannels` | 除外するチャンネル名パターン (glob対応) | `["*rss*", "*bot*"]` |
| `mentionGroups` | 監視するグループメンション (glob対応) | `["team_開発部*"]` |
| `watchKeywords` | 監視するキーワード (glob対応) | `["*障害*", "*緊急*"]` |

#### 取得されるデータ

- **Mentions**: 自分宛てのメンション + グループメンション
- **Keywords**: 監視キーワードにマッチするメッセージ
- **Channels**: 指定チャンネルのメッセージ (スレッド含む)
- **DMs**: ダイレクトメッセージ

#### ダッシュボード

Web UI の「Slack」タブで確認:
- Mentions / Channels / DMs / Keywords のタブ切り替え
- 未読バッジ表示
- 既読管理(個別・一括)
- Slack へのパーマリンク

### Claude Code 統合

Claude Code CLI のセッション履歴を自動取得・表示します。

#### セットアップ

`~/.adas/config.json` を編集:

```json
{
  "claudeCode": {
    "enabled": true,
    "fetchIntervalMinutes": 5,
    "projects": []
  }
}
```

`projects` が空の場合、全プロジェクトのセッションを取得します。

## フィードバックループシステム

ADAS は AI 出力の品質を継続的に改善するフィードバックループを実装しています。ユーザーが出力を評価すると、そのフィードバックが次回の AI 呼び出し時に few-shot examples としてプロンプトに動的挿入されます。

### フィードバック対象

| 対象 | UI | フィードバック内容 |
|------|-----|-------------------|
| **Interpret** (AI 解釈) | Activity タブ | Good/Bad + 問題点 + 修正版テキスト |
| **Summarize** (要約) | Summary タブ | Good/Neutral/Bad + 問題点 + 修正版テキスト |
| **Evaluate** (ハルシネーション評価) | Evaluator タブ | 正しい/誤検知/見逃し + 正解の判定 |

### フィードバックフロー

```
┌─────────────────────────────────────────────────────────────────┐
│                        フィードバックループ                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. AI出力         2. ユーザー評価      3. DB保存               │
│  ┌─────────┐      ┌─────────────┐     ┌─────────┐              │
│  │ Claude  │ ───> │  👍 / 👎   │ ───> │ SQLite  │              │
│  │ 出力    │      │  + 理由     │     │ 保存    │              │
│  └─────────┘      └─────────────┘     └────┬────┘              │
│       ▲                                     │                   │
│       │                                     │                   │
│       │    5. 改善された出力                │                   │
│  ┌────┴────┐                          ┌────▼────┐              │
│  │ Claude  │ <─── few-shot examples ──│ 次回    │              │
│  │ 呼び出し │      として動的挿入       │ 呼び出し │              │
│  └─────────┘                          └─────────┘              │
│                                                                 │
│  4. プロンプト拡張                                              │
│     - 良い出力例 (最新5件)                                      │
│     - 避けるべき出力例 (最新3件) + 修正版                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Few-shot Examples とは

Few-shot learning は、少数の例をプロンプトに含めることで AI の出力を誘導する手法です。

```
# 例: interpret プロンプトへの動的挿入

## 良い出力例 (参考にしてください)

入力: えーと、まあ、その、タスク管理のあれですね、完了しました
出力: タスク管理の作業が完了しました

## 避けるべき出力例 (これらの問題を避けてください)

入力: はい、そうですね、あの案件の件で
問題のある出力: 案件の件について話しています
修正版: (具体的な案件名)について確認しました
問題点: 「案件」が何を指すか不明瞭
```

### DBスキーマ

| テーブル | 用途 |
|---------|------|
| `segment_feedbacks` | interpret 用フィードバック (segmentId, rating, target, reason, issues, corrected_text) |
| `feedbacks` | summarize/evaluate 用汎用フィードバック (targetType, targetId, rating, issues, reason, correctedText, correctJudgment) |

### APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/segment-feedbacks` | interpret フィードバック送信 |
| GET | `/api/segment-feedbacks?date=YYYY-MM-DD` | interpret フィードバック取得 |
| POST | `/api/feedbacks/v2` | summarize/evaluate フィードバック送信 |
| GET | `/api/feedbacks/v2?targetType=summary&date=YYYY-MM-DD` | summarize/evaluate フィードバック取得 |

### 実装ファイル

| ファイル | 役割 |
|---------|------|
| `apps/cli/src/feedback-injector.ts` | フィードバック取得 + プロンプト挿入ロジック |
| `apps/cli/src/summarizer/prompts.ts` | summarize プロンプト構築 (フィードバック挿入対応) |
| `apps/cli/src/interpreter/run.ts` | interpret 実行 (フィードバック例を Worker に渡す) |
| `apps/worker/src/routes/interpret.ts` | interpret RPC (フィードバック例をプロンプトに追加) |
| `apps/frontend/src/components/app/feedback-dialog.tsx` | interpret フィードバック UI |
| `apps/frontend/src/components/app/summary-feedback-dialog.tsx` | summarize フィードバック UI |
| `apps/frontend/src/components/app/evaluator-feedback-dialog.tsx` | evaluate フィードバック UI |

## アーキテクチャ

### モノレポ構造

```
apps/
├── cli/                  # CLIツール(録音、設定、APIサーバー)
│   └── src/
│       ├── index.ts      # エントリポイント(Commander.js)
│       ├── config.ts     # 設定管理(~/.adas/config.json)
│       ├── commands/     # transcribe, interpret, summarize, serve, setup, worker, enroll
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
| `slack_messages` | id, date, message_ts, channel_id, channel_name, user_id, user_name, message_type, text, thread_ts, permalink, is_read, created_at |
| `github_items` | id, date, item_type, repo_owner, repo_name, number, title, state, url, author_login, labels, review_decision, is_review_requested, is_read, synced_at |
| `github_comments` | id, date, comment_type, repo_owner, repo_name, item_number, comment_id, author_login, body, url, review_state, is_read, synced_at |
| `claude_code_sessions` | id, date, session_id, project_path, project_name, start_time, end_time, user_message_count, assistant_message_count, tool_use_count, summary, created_at |

### データフロー

```
ブラウザ(MediaRecorder) → Web UI → API サーバー → WAV ファイル
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
  },
  "slack": {
    "enabled": false,
    "xoxcToken": "xoxc-...",
    "xoxdToken": "xoxd-...",
    "fetchIntervalMinutes": 5
  },
  "github": {
    "enabled": false,
    "fetchIntervalMinutes": 10,
    "parallelWorkers": 2
  },
  "claudeCode": {
    "enabled": false,
    "fetchIntervalMinutes": 5
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
