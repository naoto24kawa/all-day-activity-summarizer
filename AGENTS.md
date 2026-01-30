# AGENTS.md

AI アシスタント向け共通ドキュメント。常に日本語で回答してください。

## プロジェクト概要

**All Day Activity Summarizer (ADAS)** - PCの音声入出力を監視し、WhisperX(ローカル)で文字起こし + 話者識別、Claude Code CLI で要約するアプリケーション。

詳細なドキュメントは以下を参照:

| ドキュメント | 内容 |
|-------------|------|
| [README.md](README.md) | 概要、技術スタック、クイックスタート |
| [docs/setup.md](docs/setup.md) | セットアップ、設定、トラブルシューティング |
| [docs/cli.md](docs/cli.md) | CLI コマンドリファレンス |
| [docs/api.md](docs/api.md) | API エンドポイント |
| [docs/architecture.md](docs/architecture.md) | モノレポ構造、DB スキーマ |

## 開発ガイドライン

### コードレビューの観点

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

- 50 行以下 → KISS 優先
- 50-100 行 → 明確に異なる責任がある場合のみ分割
- 100 行以上 → SRP 優先

### Lint (Biome)

警告レベルのルール(即時対応不要):
- `noExcessiveCognitiveComplexity`: 複雑度 15 超過
- `noNonNullAssertion`: 非 null アサーション使用
- `useExhaustiveDependencies`: 依存配列不足

## UI/UX 実装方針

### キーボードショートカット

| 操作 | ショートカット | 備考 |
|-----|---------------|------|
| モーダルのOKボタン | `Cmd/Ctrl+Enter` | 送信/確定/登録など |

詳細な実装パターンは [docs/development.md](docs/development.md) を参照。

## 重要な制約事項

- **TypeScript strict モード必須**: Hono RPC に必要
- **bun:sqlite 必須**: better-sqlite3 は Bun ランタイムで未サポート
- **CSS ファイルは Biome 対象外**: Tailwind ディレクティブとの互換性のため
- **shadcn/ui は apps/frontend で実行**: ルートでは正しく動作しない
