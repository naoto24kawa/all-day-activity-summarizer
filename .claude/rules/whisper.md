# Whisper ハルシネーション対策

無音区間での定型文 (「ご視聴ありがとうございました」等) をフィルタリング。

## ファイル構成

| 種別 | パス |
|------|------|
| パターン定義 (Single Source of Truth) | `apps/cli/src/whisper/hallucination-filter.ts` |
| AI 解釈プロンプト | `packages/core/prompts/interpret.md` |
| 評価プロンプト | `packages/core/prompts/evaluate.md` |
| 自動評価 | Claude SDK (haiku) による第2段階フィルタ |

## パターン参照

AI 解釈 (interpret.md) と評価 (evaluate.md) の両プロンプトから `hallucination-filter.ts` を参照。
パターンの追加・変更は `hallucination-filter.ts` で一元管理。

## 設定

`~/.adas/config.json`:
```json
{
  "evaluator": {
    "enabled": true,
    "autoApplyPatterns": true
  }
}
```
