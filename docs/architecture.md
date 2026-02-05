# アーキテクチャ

## モノレポ構造

```
apps/
├── cli/                  # CLIツール (録音、設定、APIサーバー)
│   └── src/
│       ├── index.ts      # エントリポイント (Commander.js)
│       ├── config.ts     # 設定管理 (~/.adas/config.json)
│       ├── commands/     # transcribe, interpret, summarize, serve, setup, worker, enroll
│       ├── audio/        # ffmpeg音声キャプチャ + チャンク処理
│       ├── whisper/      # WhisperXクライアント + 評価 + 話者管理
│       ├── interpreter/  # AI 解釈共通ロジック (interpretSegments)
│       ├── summarizer/   # 要約クライアント + スケジューラ
│       ├── server/       # Hono APIサーバー + ルート定義
│       └── utils/        # 日付ユーティリティ
├── ai-worker/            # AI Worker (Claude API 処理)
│   └── src/
│       ├── app.ts        # Hono アプリ (createAIWorkerApp)
│       ├── index.ts      # サーバー起動 (:3100)
│       └── routes/       # summarize, evaluate, interpret, health
├── local-worker/         # Local Worker (ローカル処理)
│   └── src/
│       ├── app.ts        # Hono アプリ (createLocalWorkerApp)
│       ├── index.ts      # サーバー起動 (:3200)
│       └── routes/       # transcribe, tokenize, health
├── sse-server/           # SSE Server (リアルタイム更新)
│   └── src/
│       └── index.ts      # サーバー起動 (:3002)
├── backend/              # (未使用/将来用)
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
│       ├── index.ts      # re-export (runClaude, getScriptPath)
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
        ├── index.ts      # createDatabase (bun:sqlite + Drizzle)
        └── schema.ts     # テーブル定義
```

## サーバー構成

| ポート | サービス | アプリ | 用途 |
|-------|---------|--------|------|
| 3001 | CLI API | `apps/cli` | メインの REST API |
| 3002 | SSE Server | `apps/sse-server` | リアルタイム更新通知 |
| 3100 | AI Worker | `apps/ai-worker` | Claude API 処理 |
| 3200 | Local Worker | `apps/local-worker` | WhisperX, Kuromoji |

## ワークスペース依存関係

```
@repo/types  <── @repo/core <── apps/cli
@repo/db     <──────────────── apps/cli
@repo/types  <── @repo/core <── apps/ai-worker
@repo/types  <── @repo/core <── apps/local-worker
@repo/types  <──────────────── apps/frontend
```

CLI と Worker の間に直接依存はなく、HTTP (RPC) で通信。Worker は別マシンにデプロイ可能。

## DBスキーマ

| テーブル | カラム |
|---------|--------|
| `transcription_segments` | id, date, start_time, end_time, audio_source, audio_file_path, transcription, language, confidence, speaker, interpreted_text, created_at |
| `summaries` | id, date, period_start, period_end, summary_type (pomodoro/hourly/daily), content, segment_ids, model, created_at |
| `memos` | id, date, content, created_at |
| `evaluator_logs` | id, date, audio_file_path, transcription_text, judgment, confidence, reason, suggested_pattern, pattern_applied, created_at |
| `slack_messages` | id, date, message_ts, channel_id, channel_name, user_id, user_name, message_type, text, thread_ts, permalink, is_read, created_at |
| `github_items` | id, date, item_type, repo_owner, repo_name, number, title, state, url, author_login, labels, review_decision, is_review_requested, is_read, synced_at |
| `github_comments` | id, date, comment_type, repo_owner, repo_name, item_number, comment_id, author_login, body, url, review_state, is_read, synced_at |
| `claude_code_sessions` | id, date, session_id, project_path, project_name, start_time, end_time, user_message_count, assistant_message_count, tool_use_count, summary, created_at |
| `tasks` | id, date, slack_message_id, github_comment_id, memo_id, source_type, title, description, status, priority, confidence, due_date, created_at |
| `learnings` | id, source_type, source_id, project_id, date, content, category, tags, confidence, repetition_count, ease_factor, interval, next_review_at, created_at |
| `extraction_logs` | id, extraction_type, source_type, source_id, extracted_count, extracted_at |
| `projects` | id, name, path, github_owner, github_repo, is_active, created_at |
| `user_profile` | id, specialties, known_technologies, learning_goals, updated_at |

## データフロー

```
ブラウザ (MediaRecorder) → Web UI → API サーバー → WAV ファイル
  → Local Worker (WhisperX) → テキスト + 話者ラベル → SQLite
  → AI Worker (Claude sonnet) → AI 解釈 (interpretedText)
  → AI Worker (Claude haiku) → ハルシネーション評価 → パターン自動追加
  → AI Worker (Claude) → ポモドーロ/時間/日次要約
  → Hono API → React ダッシュボード
  → SSE Server → リアルタイム更新通知
```
