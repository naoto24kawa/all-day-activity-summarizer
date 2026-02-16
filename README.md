# All Day Activity Summarizer (ADAS)

PC の音声入出力を監視し、WhisperX でローカル文字起こし + Claude で要約するアプリケーション。

## 主な機能

| カテゴリ | 機能 |
|---------|------|
| 音声認識 | WhisperX 文字起こし、話者識別、ハルシネーション評価 |
| AI 要約 | 時間単位/日次要約、個人作業/チーム活動の自動分類 |
| 外部連携 | Slack、GitHub、Claude Code からの自動取得 |
| タスク管理 | AI によるタスク抽出・完了検知、プロジェクト管理 |
| 学習支援 | 単語帳、ユーザープロフィール、プロンプト自動改善 |

## クイックスタート

```bash
# 1. 依存関係インストール
bun install

# 2. WhisperX セットアップ (音声認識を使う場合)
bun run cli -- setup

# 3. サーバー起動 (2つのターミナルで)
bun run cli -- workers  # ターミナル1: Worker
bun run cli -- serve    # ターミナル2: API サーバー
```

起動後、http://localhost:3001 で Web UI にアクセスできます。

## サーバー構成

| ポート | サービス | 用途 |
|-------|---------|------|
| 3001 | API Server | REST API + Web UI |
| 3002 | SSE Server | リアルタイム通知 |
| 3100 | AI Worker | Claude API 処理 |
| 3200 | Local Worker | WhisperX 文字起こし |

## 設定

設定ファイル `~/.adas/config.json` は初回起動時に自動生成されます。

```json
{
  "whisper": { "enabled": true, "hfToken": "hf_..." },
  "slack": { "enabled": true, "xoxcToken": "...", "xoxdToken": "..." },
  "github": { "enabled": true, "username": "..." },
  "claudeCode": { "enabled": true }
}
```

詳細は [セットアップガイド](docs/setup.md) を参照してください。

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [セットアップガイド](docs/setup.md) | インストール、設定、トークン取得、トラブルシューティング |
| [CLI リファレンス](docs/cli.md) | 各コマンドの使い方 |
| [AI プロバイダー設定](docs/ai-providers.md) | Gemini / Claude / LM Studio の切り替えと負荷分散 |
| [外部サービス統合](docs/integrations.md) | Slack / GitHub / Claude Code 連携 |
| [アーキテクチャ](docs/architecture.md) | モノレポ構造、DB スキーマ |

## ライセンス

MIT License
