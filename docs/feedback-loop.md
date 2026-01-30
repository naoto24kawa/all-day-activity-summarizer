# フィードバックループシステム

ADAS は AI 出力の品質を継続的に改善するフィードバックループを実装しています。

## 2つの改善メカニズム

ADAS には2種類のフィードバックメカニズムがあります:

1. **動的 few-shot 挿入**: フィードバックを次回の AI 呼び出し時に例として挿入
2. **プロンプト自動改善 (ユーザー承認方式)**: フィードバックを分析してプロンプト自体を改善

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

---

## プロンプト自動改善 (ユーザー承認方式)

悪いフィードバックが一定数溜まると、AI がプロンプト改善案を生成します。ユーザーが承認するまでプロンプトは変更されません。

### フロー

```
┌─────────────────────────────────────────────────────────────────┐
│                   プロンプト自動改善フロー                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. フィードバック蓄積   2. 改善案生成      3. ユーザー承認      │
│  ┌─────────────┐       ┌─────────────┐    ┌─────────────┐      │
│  │ Bad が     │ ───>  │ AI が      │ ──> │ 差分確認    │      │
│  │ 3件以上    │       │ 改善案生成  │    │ 承認/却下   │      │
│  └─────────────┘       └─────────────┘    └──────┬──────┘      │
│                                                   │             │
│  4. プロンプト更新                                │             │
│  ┌─────────────┐                                 │             │
│  │ 承認時のみ  │ <────────────────────────────────┘             │
│  │ ファイル更新 │                                               │
│  └─────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 改善対象プロンプト

| ターゲット | プロンプトファイル |
|-----------|-------------------|
| interpret | `packages/core/prompts/interpret.md` |
| evaluate | `packages/core/prompts/evaluate.md` |
| summarize-hourly | `packages/core/prompts/summarize-hourly.md` |
| summarize-daily | `packages/core/prompts/summarize-daily.md` |
| task-extract | `packages/core/prompts/task-extract.md` |

### DBスキーマ (prompt_improvements)

| カラム | 型 | 説明 |
|--------|-----|------|
| target | TEXT | 改善対象 (interpret, evaluate, etc.) |
| previousPrompt | TEXT | 変更前のプロンプト |
| newPrompt | TEXT | 改善後のプロンプト |
| feedbackCount | INTEGER | 分析したフィードバック数 |
| goodCount | INTEGER | Good フィードバック数 |
| badCount | INTEGER | Bad フィードバック数 |
| improvementReason | TEXT | 改善理由 |
| status | TEXT | pending / approved / rejected |
| approvedAt | TEXT | 承認日時 |
| rejectedAt | TEXT | 却下日時 |

### APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/prompt-improvements` | 改善案一覧 |
| GET | `/api/prompt-improvements/stats` | 各ターゲットの統計 |
| POST | `/api/prompt-improvements/generate` | 改善案生成 |
| POST | `/api/prompt-improvements/:id/approve` | 承認 (プロンプト更新) |
| POST | `/api/prompt-improvements/:id/reject` | 却下 |

### UI (Settings タブ)

Settings タブの「プロンプト改善」パネルから操作:

1. **統計タブ**: 各ターゲットのフィードバック数と「改善案を生成」ボタン
2. **承認待ちタブ**: 未承認の改善案一覧、差分確認、承認/却下ボタン
3. **履歴タブ**: 過去の承認/却下履歴

### 実装ファイル

| ファイル | 役割 |
|---------|------|
| `apps/cli/src/server/routes/prompt-improvements.ts` | API ルート |
| `apps/frontend/src/hooks/use-prompt-improvements.ts` | フック |
| `apps/frontend/src/components/app/prompt-improvements-panel.tsx` | UI コンポーネント |

---

## ユーザープロフィール提案 (フィードバックループ)

活動データからユーザーの技術プロフィールを自動提案し、ユーザー承認後にプロフィールを更新。学び抽出時にプロフィール情報を活用して精度を向上させます。

### フロー

```
┌─────────────────────────────────────────────────────────────────┐
│              プロフィール提案フィードバックループ                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 活動データ収集      2. AI 分析         3. ユーザー承認       │
│  ┌─────────────┐       ┌─────────────┐    ┌─────────────┐      │
│  │ Claude Code │       │ Worker      │    │ 承認/却下   │      │
│  │ Learnings   │ ───>  │ analyze-    │ ──>│ UI で確認   │      │
│  │ GitHub      │       │ profile     │    └──────┬──────┘      │
│  └─────────────┘       └─────────────┘           │             │
│                                                   │             │
│  4. プロフィール更新                              │             │
│  ┌─────────────┐                                 │             │
│  │ user_profile│ <────────────────────────────────┘             │
│  │ テーブル更新 │                                               │
│  └──────┬──────┘                                               │
│         │                                                       │
│  5. 学び抽出精度向上                                            │
│  ┌──────▼──────┐                                               │
│  │ extract-    │  プロフィール情報を参照:                       │
│  │ learnings   │  - 既知技術の基礎は除外                        │
│  │             │  - 学習目標に関連する内容を優先                 │
│  └─────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### プロフィール項目

| 項目 | 説明 | 例 |
|------|------|-----|
| experienceYears | 経験年数 | 5 |
| specialties | 専門分野 | ["frontend", "typescript"] |
| knownTechnologies | 既知技術 | ["React", "Hono", "Bun"] |
| learningGoals | 学習目標 | ["Rust", "DDD"] |

### 提案タイプ

| タイプ | 説明 |
|--------|------|
| add_technology | 新しい技術をknownTechnologiesに追加 |
| add_specialty | 新しい専門分野をspecialtiesに追加 |
| add_goal | 新しい学習目標をlearningGoalsに追加 |
| update_experience | 経験年数を更新 (通常は提案しない) |

### DBスキーマ

| テーブル | 用途 |
|---------|------|
| `user_profile` | ユーザープロフィール (単一レコード) |
| `profile_suggestions` | プロフィール提案 (suggestionType, field, value, reason, sourceType, confidence, status) |

### APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/profile` | プロフィール取得 |
| PUT | `/api/profile` | プロフィール更新 |
| GET | `/api/profile/suggestions` | 提案一覧 |
| POST | `/api/profile/suggestions/generate` | 提案生成 |
| POST | `/api/profile/suggestions/:id/accept` | 承認 |
| POST | `/api/profile/suggestions/:id/reject` | 却下 |

### UI (Settings タブ)

Settings タブの「Profile Settings」パネルから操作:

1. **プロフィール設定**: 経験年数、専門分野、既知技術、学習目標を編集
2. **提案パネル**: 承認待ちの提案一覧、承認/却下ボタン、「提案を生成」ボタン

### 実装ファイル

| ファイル | 役割 |
|---------|------|
| `apps/cli/src/server/routes/profile.ts` | API ルート |
| `apps/cli/src/claude-code/extractor.ts` | 学び抽出 (プロフィール注入) |
| `apps/worker/src/routes/analyze-profile.ts` | 提案生成 Worker |
| `apps/worker/src/routes/extract-learnings.ts` | 学び抽出 (プロフィール対応) |
| `apps/frontend/src/hooks/use-profile.ts` | フック |
| `apps/frontend/src/components/app/profile-panel.tsx` | UI コンポーネント |
