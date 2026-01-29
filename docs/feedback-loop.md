# フィードバックループシステム

ADAS は AI 出力の品質を継続的に改善するフィードバックループを実装しています。ユーザーが出力を評価すると、そのフィードバックが次回の AI 呼び出し時に few-shot examples としてプロンプトに動的挿入されます。

## フィードバック対象

| 対象 | UI | フィードバック内容 |
|------|-----|-------------------|
| **Interpret** (AI 解釈) | Activity タブ | Good/Bad + 問題点 + 修正版テキスト |
| **Summarize** (要約) | Summary タブ | Good/Neutral/Bad + 問題点 + 修正版テキスト |
| **Evaluate** (ハルシネーション評価) | Evaluator タブ | 正しい/誤検知/見逃し + 正解の判定 |

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

## Few-shot Examples とは

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

## DBスキーマ

| テーブル | 用途 |
|---------|------|
| `segment_feedbacks` | interpret 用フィードバック (segmentId, rating, target, reason, issues, corrected_text) |
| `feedbacks` | summarize/evaluate 用汎用フィードバック (targetType, targetId, rating, issues, reason, correctedText, correctJudgment) |

## APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/segment-feedbacks` | interpret フィードバック送信 |
| GET | `/api/segment-feedbacks?date=YYYY-MM-DD` | interpret フィードバック取得 |
| POST | `/api/feedbacks/v2` | summarize/evaluate フィードバック送信 |
| GET | `/api/feedbacks/v2?targetType=summary&date=YYYY-MM-DD` | summarize/evaluate フィードバック取得 |

## 実装ファイル

| ファイル | 役割 |
|---------|------|
| `packages/core/src/feedback-injector.ts` | フィードバック取得 + プロンプト挿入ロジック |
| `apps/cli/src/summarizer/prompts.ts` | summarize プロンプト構築 (フィードバック挿入対応) |
| `apps/cli/src/interpreter/run.ts` | interpret 実行 (フィードバック例を Worker に渡す) |
| `apps/worker/src/routes/interpret.ts` | interpret RPC (フィードバック例をプロンプトに追加) |
| `apps/frontend/src/components/app/feedback-dialog.tsx` | interpret フィードバック UI |
| `apps/frontend/src/components/app/summary-feedback-dialog.tsx` | summarize フィードバック UI |
| `apps/frontend/src/components/app/evaluator-feedback-dialog.tsx` | evaluate フィードバック UI |
