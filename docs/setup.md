# セットアップガイド

## 前提条件

| ソフトウェア | 用途 | 必須 |
|------------|------|------|
| **Bun** v1.1.44+ | ランタイム・パッケージ管理 | Yes |
| **Python 3.11-3.13** + **venv** | WhisperX 実行環境 | Yes |
| **cmake** + **g++** (or clang) | whisper.cpp ビルド(fallback) | Yes |
| **git** | whisper.cpp クローン | Yes |
| **Claude Code CLI** (`claude`) | 要約・評価実行 | Yes |
| **HuggingFace トークン** | 話者ダイアライゼーション | 話者識別を使う場合 |

## システムパッケージのインストール

### macOS

```bash
brew install cmake python@3.12
```

### Ubuntu / Debian / WSL2

```bash
sudo apt update
sudo apt install -y \
  cmake g++ git \
  python3 python3-venv python3-pip

# Python 3.12 の場合(Ubuntu 24.04+)
# sudo apt install -y python3.12-venv
```

### Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### Claude Code CLI

https://docs.anthropic.com/en/docs/claude-code/overview を参照

```bash
# macOS
brew install claude-code

# Linux
sudo snap install claude-code --classic
```

## インストール

```bash
# 依存関係のインストール
bun install

# WhisperX + whisper.cpp のセットアップ
bun run cli -- setup

# 動作確認
bun run cli -- --help
```

## 環境変数

```bash
# HuggingFace トークン(話者ダイアライゼーションに必要)
export HF_TOKEN=hf_...

# ~/.adas/config.json の whisper.hfToken にも設定可能
```

## 設定ファイル

`~/.adas/config.json` で各機能を設定できます。
初回起動時に自動生成されるため、手動で作成する必要はありません。

### 最小構成 (音声認識のみ)

```json
{}
```

空の JSON でも起動可能です。全てデフォルト値が使用されます。

### 推奨構成

```json
{
  "whisper": {
    "enabled": true,
    "hfToken": "hf_..."
  },
  "slack": {
    "enabled": true,
    "xoxcToken": "xoxc-...",
    "xoxdToken": "xoxd-...",
    "userId": "U12345678",
    "channels": ["C123456789"],
    "watchKeywords": ["キーワード"]
  },
  "github": {
    "enabled": true,
    "username": "your-github-username"
  },
  "claudeCode": {
    "enabled": true
  }
}
```

### 全設定項目

```json
{
  "recordingsDir": "~/.adas/recordings",
  "dbPath": "~/.adas/adas.db",
  "whisper": {
    "enabled": true,
    "modelName": "ggml-large-v3-turbo-q5_0.bin",
    "language": "ja",
    "engine": "whisperx",
    "hfToken": "hf_..."
  },
  "audio": {
    "sampleRate": 16000,
    "channels": 1,
    "chunkDurationMinutes": 2
  },
  "server": { "port": 3001 },
  "evaluator": {
    "enabled": true,
    "autoApplyPatterns": true
  },
  "worker": {
    "url": "http://localhost:3100",
    "timeout": 300000
  },
  "localWorker": {
    "url": "http://localhost:3200",
    "timeout": 300000
  },
  "sseServer": {
    "url": "http://localhost:3002",
    "port": 3002
  },
  "slack": {
    "enabled": false,
    "xoxcToken": "xoxc-...",
    "xoxdToken": "xoxd-...",
    "userId": "U12345678",
    "fetchIntervalMinutes": 5,
    "parallelWorkers": 3,
    "channels": [],
    "excludeChannels": [],
    "mentionGroups": [],
    "watchKeywords": []
  },
  "github": {
    "enabled": false,
    "username": "",
    "fetchIntervalMinutes": 10,
    "parallelWorkers": 2
  },
  "claudeCode": {
    "enabled": false,
    "fetchIntervalMinutes": 5,
    "parallelWorkers": 2,
    "projects": []
  },
  "promptImprovement": {
    "enabled": false,
    "badFeedbackThreshold": 5
  },
  "summarizer": {
    "dailyScheduleHour": 23,
    "timesIntervalMinutes": 0
  }
}
```

### 設定項目の説明

| 項目 | 説明 |
|------|------|
| `whisper.enabled` | 音声認識の有効/無効 |
| `whisper.hfToken` | HuggingFace トークン (話者識別に必要) |
| `slack.enabled` | Slack 連携の有効/無効 |
| `slack.xoxcToken` / `xoxdToken` | Slack ブラウザセッションのトークン |
| `slack.userId` | 自分の Slack ユーザーID (例: `U12345678`) |
| `slack.channels` | 監視するチャンネル ID の配列 |
| `slack.watchKeywords` | 監視するキーワードの配列 |
| `github.enabled` | GitHub 連携の有効/無効 |
| `github.username` | GitHub ユーザー名 (Issue/PR のフィルタに使用) |
| `claudeCode.enabled` | Claude Code 連携の有効/無効 |
| `claudeCode.projects` | 監視するプロジェクトパス (空配列で全プロジェクト) |
| `summarizer.dailyScheduleHour` | 日次サマリの自動生成時間 (0-23) |
| `summarizer.timesIntervalMinutes` | 時間サマリの自動生成間隔 (0 = 無効) |

---

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

話者ダイアライゼーション (誰が話したかを識別) には HuggingFace トークンが必要です。

**取得手順:**

1. **HuggingFace アカウント作成**
   - https://huggingface.co/join でアカウントを作成

2. **トークンの発行**
   - https://huggingface.co/settings/tokens にアクセス
   - 「New token」をクリック
   - Token type: `Read` を選択
   - 「Generate token」でトークンを作成
   - 表示されたトークン (`hf_...`) をコピー

3. **pyannote モデルの利用規約に同意**
   - https://huggingface.co/pyannote/speaker-diarization-3.1 にアクセス
   - ページ下部の「I have read and accept the license terms」にチェック
   - 「Submit」をクリック

4. **トークンの設定** (いずれかの方法)

   **方法 A: 設定ファイルに記載**
   ```json
   {
     "whisper": {
       "hfToken": "hf_xxxxxxxxxxxxxxxxxxxx"
     }
   }
   ```

   **方法 B: 環境変数で設定**
   ```bash
   export HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx
   ```

**注意:** HuggingFace トークンがない場合でも音声認識は動作しますが、話者識別は無効になります。

### キャッシュのクリア

```bash
rm -rf node_modules bun.lock
bun install
```
