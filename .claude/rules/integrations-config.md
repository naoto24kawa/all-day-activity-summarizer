# 連携機能のオンオフ設定

Slack、GitHub、Claude Code などの連携機能を UI から有効/無効に切り替え可能。

## ファイル構成

| 種別 | パス |
|------|------|
| API | `apps/cli/src/server/routes/config.ts` |
| フロントエンド | `apps/frontend/src/components/app/integrations-panel.tsx` |
| フック | `apps/frontend/src/hooks/use-config.ts` |
| 設定ファイル | `~/.adas/config.json` |

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/config` | 連携設定の取得 (トークン等は除外) |
| `PATCH` | `/api/config/integrations` | 連携のオンオフ更新 |

## 設定可能な連携

| 連携 | 設定キー | 説明 |
|------|----------|------|
| Whisper | `whisper.enabled` | 音声の自動文字起こし |
| Slack | `slack.enabled` | メンション・キーワード監視 |
| GitHub | `github.enabled` | Issue/PR 監視 |
| Claude Code | `claudeCode.enabled` | セッション履歴・学び抽出 |
| Evaluator | `evaluator.enabled` | 文字起こし品質評価 |
| Prompt Improvement | `promptImprovement.enabled` | プロンプト自動改善 |

## 注意事項

- 設定変更後はサーバーの再起動が必要
- 無効化された連携のタブは「無効化されています」メッセージを表示
- 認証情報 (トークン等) が未設定の場合、トグルは無効化
