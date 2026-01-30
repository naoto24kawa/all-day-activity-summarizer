# フィードバックループシステム

ADAS は AI 出力の品質を継続的に改善するフィードバックループを実装しています。

## 2つの改善メカニズム

1. **動的 few-shot 挿入**: フィードバックを次回の AI 呼び出し時に例として挿入
2. **プロンプト自動改善**: フィードバックを分析してプロンプト自体を改善 (詳細: `.claude/rules/prompt-improvement.md`)

## フィードバック対象

| 対象 | UI | フィードバック内容 |
|------|-----|-------------------|
| **Interpret** (AI 解釈) | Activity タブ | Good/Bad + 問題点 + 修正版テキスト |
| **Summarize** (要約) | Summary タブ | Good/Neutral/Bad + 問題点 + 修正版テキスト |
| **Evaluate** (ハルシネーション評価) | Evaluator タブ | 正しい/誤検知/見逃し + 正解の判定 |
| **Task Extract** (タスク抽出) | Slack タブ | 承認/却下 + 却下理由 |

## フィードバックフロー

```
┌─────────────────────────────────────────────────────────────────┐
│                        フィードバックループ                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. AI出力         2. ユーザー評価      3. DB保存               │
│  ┌─────────┐      ┌─────────────┐     ┌─────────┐              │
│  │ Claude  │ ───> │  Good/Bad  │ ───> │ SQLite  │              │
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

## Few-shot Examples

少数の例をプロンプトに含めることで AI の出力を誘導する手法。

```
## 良い出力例 (参考にしてください)

入力: えーと、まあ、その、タスク管理のあれですね、完了しました
出力: タスク管理の作業が完了しました

## 避けるべき出力例 (これらの問題を避けてください)

入力: はい、そうですね、あの案件の件で
問題のある出力: 案件の件について話しています
修正版: (具体的な案件名)について確認しました
問題点: 「案件」が何を指すか不明瞭
```

## DBスキーマ

| テーブル | 用途 |
|---------|------|
| `segment_feedbacks` | interpret 用フィードバック |
| `feedbacks` | summarize/evaluate 用汎用フィードバック |

## APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/segment-feedbacks` | interpret フィードバック送信 |
| GET | `/api/segment-feedbacks?date=YYYY-MM-DD` | interpret フィードバック取得 |
| POST | `/api/feedbacks/v2` | summarize/evaluate フィードバック送信 |
| GET | `/api/feedbacks/v2?targetType=summary&date=YYYY-MM-DD` | フィードバック取得 |

## 実装ファイル

| ファイル | 役割 |
|---------|------|
| `packages/core/src/feedback-injector.ts` | フィードバック取得 + プロンプト挿入ロジック |
| `apps/cli/src/summarizer/prompts.ts` | summarize プロンプト構築 |
| `apps/cli/src/interpreter/run.ts` | interpret 実行 |
| `apps/worker/src/routes/interpret.ts` | interpret RPC |
| `apps/frontend/src/components/app/feedback-dialog.tsx` | interpret フィードバック UI |
| `apps/frontend/src/components/app/summary-feedback-dialog.tsx` | summarize フィードバック UI |
| `apps/frontend/src/components/app/evaluator-feedback-dialog.tsx` | evaluate フィードバック UI |

---

## 関連ドキュメント

- プロンプト自動改善の詳細: `.claude/rules/prompt-improvement.md`
- プロフィール提案の詳細: `.claude/rules/profile.md`
