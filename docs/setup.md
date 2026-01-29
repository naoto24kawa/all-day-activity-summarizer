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

話者ダイアライゼーションには HuggingFace トークンが必要:

1. https://huggingface.co/settings/tokens でトークンを取得
2. pyannote のモデル利用規約に同意(https://huggingface.co/pyannote/speaker-diarization-3.1)
3. `~/.adas/config.json` の `whisper.hfToken` に設定、または `HF_TOKEN` 環境変数をセット

### キャッシュのクリア

```bash
rm -rf node_modules bun.lock
bun install
```
