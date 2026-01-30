# All Day Activity Summarizer (ADAS)

PCの音声入出力を1日中監視し、WhisperX(ローカル)で文字起こし + 話者識別、Claude Code CLIで要約するアプリケーション。
CLIツール + Worker(文字起こし/評価) + Web UIダッシュボードの3層構成。

## 主な機能

- ブラウザベースの音声録音(Web UI から操作)
- WhisperX(ローカル)による文字起こし + 話者ダイアライゼーション
- Claude(sonnet)による音声認識テキストのAI解釈(読みやすい日本語への整形)
- Claude Code CLI による時間単位/日次要約
- ハルシネーション自動評価 + パターン自動追加
- 話者登録(声紋埋め込み) + 未知話者の名前割り当て
- SQLite(bun:sqlite + Drizzle ORM)によるデータ永続化
- React + shadcn/ui ダッシュボードUI
- **Slack 統合**: メンション・チャンネル・DM の自動取得
- **GitHub 統合**: Issue/PR/レビューリクエストの自動取得
- **Claude Code 統合**: セッション履歴の自動取得・表示
- **タスク抽出**: Slack/GitHub/メモから AI でタスクを自動抽出、フィードバックループで精度向上
- **タスク完了検知**: GitHub/Claude Code/Slack/音声から AI でタスク完了を自動検知
- **プロジェクト管理**: プロジェクト単位でタスク・学びを管理、GitHub リポジトリと連携
- **ユーザープロフィール管理**: 技術スキル・専門分野の自動提案と学び抽出精度向上

## 技術スタック

| 機能 | 技術 |
|------|------|
| 音声キャプチャ | ブラウザ MediaRecorder API |
| 文字起こし | WhisperX(ローカル) |
| 要約/評価 | Claude Code CLI |
| DB | SQLite(bun:sqlite + Drizzle ORM) |
| CLI | Commander.js + Bun |
| Worker | Hono + Bun.serve |
| APIサーバー | Hono + @hono/node-server |
| UI | React 19 + Vite + Tailwind CSS 4 + shadcn/ui |

## クイックスタート

```bash
# 依存関係のインストール
bun install

# WhisperX + whisper.cpp のセットアップ
bun run cli -- setup

# Worker 起動(ターミナル1)
bun run cli -- worker

# APIサーバー + 録音 + 要約スケジューラ(ターミナル2)
bun run cli -- serve
```

詳細は [セットアップガイド](docs/setup.md) を参照してください。

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [セットアップガイド](docs/setup.md) | インストール、設定、トラブルシューティング |
| [CLIコマンドリファレンス](docs/cli.md) | 各コマンドの使い方 |
| [APIエンドポイント](docs/api.md) | CLI APIサーバー・Worker RPC の詳細 |
| [外部サービス統合](docs/integrations.md) | GitHub、Slack、Claude Code との連携方法 |
| [フィードバックループ](docs/feedback-loop.md) | AI出力品質の継続的改善システム |
| [アーキテクチャ](docs/architecture.md) | モノレポ構造、DBスキーマ、データフロー |
| [開発ワークフロー](docs/development.md) | 開発コマンド、品質管理、Git Hooks |

## ライセンス

MIT License
