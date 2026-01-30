# ユーザープロフィール

技術スキル・専門分野を管理し、学び抽出の精度向上に活用。

## ファイル構成

| 種別 | パス |
|------|------|
| DB テーブル | `user_profile`, `profile_suggestions` |
| API | `apps/cli/src/server/routes/profile.ts` |
| フロントエンド | `apps/frontend/src/components/app/profile-panel.tsx` |
| Worker | `apps/worker/src/routes/analyze-profile.ts` |

## プロフィール項目

| 項目 | 説明 | 例 |
|------|------|-----|
| experienceYears | 経験年数 | 5 |
| specialties | 専門分野 | ["frontend", "typescript"] |
| knownTechnologies | 既知技術 | ["React", "Hono", "Bun"] |
| learningGoals | 学習目標 | ["Rust", "DDD"] |

## タスク統合

プロフィール提案は Tasks タブにタスクとして表示。

- 承認するとプロフィールに自動反映
- 却下すると提案も自動的に却下

## 学び抽出での活用

`apps/cli/src/claude-code/extractor.ts` でプロフィール情報を参照:
- 既知の技術の基礎的な内容を除外
- 学習目標に関連する内容を優先

## 提案タイプ

| タイプ | 説明 |
|--------|------|
| add_technology | 新しい技術をknownTechnologiesに追加 |
| add_specialty | 新しい専門分野をspecialtiesに追加 |
| add_goal | 新しい学習目標をlearningGoalsに追加 |
