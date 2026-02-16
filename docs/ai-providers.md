# AI プロバイダー設定

ADAS では複数の AI プロバイダーを使用して、コスト最適化と負荷分散を実現しています。

## サポートしているプロバイダー

| プロバイダー | 説明 | 用途 |
|------------|------|------|
| **Gemini** | Google の Gemini CLI | 高速・低コスト (デフォルト) |
| **Claude** | Anthropic の Claude Code CLI | 高品質・開発作業用 |
| **LM Studio** | ローカル LLM サーバー | オフライン推論 |

## デフォルト設定

Claude は開発作業で使用するため、AI Worker では **Gemini を優先** して使用します。

処理タイプごとに Claude のモデル使用状況に合わせた Gemini モデルが自動選択されます:

| 処理タイプ | Gemini モデル | Claude 相当 |
|-----------|--------------|------------|
| summarize (要約) | `gemini-1.5-pro` | sonnet |
| extractLearnings (学び抽出) | `gemini-1.5-pro` | sonnet |
| その他の処理 | `gemini-1.5-flash` | haiku |

```json
{
  "aiProvider": {
    "providers": {
      "summarize": "gemini",
      "evaluate": "gemini",
      "interpret": "gemini",
      "taskExtract": "gemini",
      // ...全ての処理タイプで gemini がデフォルト
    },
    "gemini": {
      "model": "gemini-1.5-flash"  // デフォルトモデル (処理タイプごとに自動選択)
    },
    "enableFallback": true
  }
}
```

## CLI コマンド

### 現在の設定を表示

```bash
adas provider show
```

出力例:
```
╭───────────────────╮
│  現在の AI プロバイダー設定  │
╰───────────────────╯

ℹ 要約 (Summarize): Gemini (高速・低コスト)
ℹ タグ提案 (Suggest Tags): Gemini (高速・低コスト)
ℹ 評価 (Evaluate): Gemini (高速・低コスト)
...
```

### インタラクティブに設定変更

```bash
adas provider setup
```

対話形式で処理タイプとプロバイダーを選択できます。

### 全ての処理を一括設定

```bash
# 全て Gemini に設定
adas provider set-all gemini

# 全て Claude に設定
adas provider set-all claude

# 全て LM Studio に設定
adas provider set-all lmstudio
```

## 処理タイプ一覧

| 処理タイプ | 説明 |
|-----------|------|
| `summarize` | 要約生成 |
| `suggestTags` | メモのタグ提案 |
| `evaluate` | 文字起こし品質評価 |
| `interpret` | 音声テキストの整形・用語抽出 |
| `checkCompletion` | タスク完了検知 |
| `analyzeProfile` | プロフィール分析 |
| `extractLearnings` | 学び抽出 |
| `taskExtract` | タスク抽出 |
| `slackPriority` | Slack メッセージの優先度判定 |
| `generateReadings` | 用語の読み仮名生成 |

## フォールバック機能

`enableFallback: true` の場合、プライマリプロバイダーが失敗すると自動的に Claude にフォールバックします。

```json
{
  "aiProvider": {
    "enableFallback": true
  }
}
```

これにより、Gemini や LM Studio が利用できない場合でも処理を継続できます。

## プロバイダーごとの特徴

### Gemini (推奨)

- **利点**: 高速、低コスト、Claude と同等の品質
- **欠点**: CLI が必要 (`gemini` コマンド)
- **モデル**: `gemini-1.5-flash` (デフォルト), `gemini-1.5-pro`

### Claude

- **利点**: 最高品質の出力
- **欠点**: コストが高い、開発作業と競合する可能性
- **モデル**: `haiku`, `sonnet`, `opus-4`

### LM Studio

- **利点**: オフラインで動作、コストゼロ
- **欠点**: 速度が遅い、品質が劣る可能性
- **設定**: `~/.adas/config.json` の `lmstudio.url` と `lmstudio.model` を設定

## トラブルシューティング

### Gemini CLI が見つからない

```bash
# Gemini CLI のインストール確認
which gemini

# インストールされていない場合
brew install gemini  # または適切なインストール方法
```

### プロバイダーが失敗する

ログを確認してください:

```bash
# AI Worker のログ
tail -f ~/.adas/logs/ai-worker-2026-02-13.log
```

フォールバックが有効な場合、自動的に Claude に切り替わります。

## 設定ファイル

設定は `~/.adas/config.json` に保存されます:

```json
{
  "aiProvider": {
    "gemini": {
      "model": "gemini-1.5-flash"
    },
    "providers": {
      "summarize": "gemini",
      "evaluate": "gemini",
      ...
    },
    "enableFallback": true
  }
}
```

設定変更後、サーバーを再起動してください:

```bash
# サーバーを停止
Ctrl+C

# サーバーを再起動
adas serve
```
