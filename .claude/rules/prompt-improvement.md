# プロンプト定期見直し

組み込まれたプロンプトを定期的に見直し、フィードバックに基づいて改善案を自動生成。
Claude Opus を使用して高品質な改善案を生成し、ユーザー承認後に適用。

## 実行タイミング

- **自動実行**: 毎日 6:00 (serve コマンド起動中)
- **手動実行**: UI の「プロンプト改善」パネルから「改善案を生成」ボタン

## ファイル構成

| 種別 | パス |
|------|------|
| スケジューラー | `apps/cli/src/prompt-improvement/scheduler.ts` |
| 改善ロジック | `apps/cli/src/prompts/improver.ts` |
| API ルート | `apps/cli/src/server/routes/prompt-improvements.ts` |
| フロントエンド | `apps/frontend/src/components/app/prompt-improvements-panel.tsx` |

## 処理フロー

```
毎日 6:00
    ↓
各プロンプトターゲットをチェック
    ↓
[条件チェック]
- pending の改善案がない
- bad フィードバック >= 3件
    ↓ Yes
Claude Opus で改善案を生成
    ↓
DB に保存 (status: pending)
    ↓
tasks テーブルに登録 ([定期見直し] ラベル付き)
```

## 実行条件

| 条件 | 説明 |
|------|------|
| 既存の pending 改善案がない | 未承認の改善案がある場合はスキップ |
| bad フィードバック >= 3件 | 最終改善日以降のフィードバックをカウント |

## 改善対象プロンプト

| ターゲット | プロンプトファイル |
|-----------|-------------------|
| interpret | `packages/core/prompts/interpret.md` |
| evaluate | `packages/core/prompts/evaluate.md` |
| summarize-times | `packages/core/prompts/summarize-times.md` |
| summarize-daily | `packages/core/prompts/summarize-daily.md` |
| task-extract | `packages/core/prompts/task-extract.md` |

## 設定

`~/.adas/config.json`:
```json
{
  "promptImprovement": {
    "enabled": true
  }
}
```
