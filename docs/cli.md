# CLI コマンドリファレンス

## コマンド一覧

```bash
bun run cli -- <command> [options]
```

### setup

WhisperX venv + whisper.cpp fallback の初期セットアップ

```bash
bun run cli -- setup
```

### serve

APIサーバー + 録音 + 要約スケジューラ

```bash
bun run cli -- serve
bun run cli -- serve -p 8080
```

提供機能:
1. ローカルAPIサーバー (:3001)
2. ブラウザ経由での音声録音 (Web UI から操作)
3. 定期要約スケジューラ (ポモドーロ30分 + 1時間ごと + 日終了時)

### Worker コマンド

Worker は AI Worker と Local Worker に分離されています。

#### ai-worker

Claude API を使う処理を担当

```bash
bun run cli -- ai-worker
bun run cli -- ai-worker -p 3100
```

エンドポイント:
- `POST /rpc/summarize` - Claude 要約実行
- `POST /rpc/evaluate` - ハルシネーション評価
- `POST /rpc/interpret` - AI テキスト解釈
- `POST /rpc/extract-terms` - 用語抽出
- `GET /rpc/health` - ヘルスチェック

#### local-worker

ローカル処理 (WhisperX, Kuromoji) を担当

```bash
bun run cli -- local-worker
bun run cli -- local-worker -p 3200
```

エンドポイント:
- `POST /rpc/transcribe` - WhisperX 文字起こし
- `POST /rpc/tokenize` - Kuromoji 形態素解析
- `GET /rpc/health` - ヘルスチェック

#### workers

両方のワーカーを同時起動

```bash
bun run cli -- workers
bun run cli -- workers --ai-port 3100 --local-port 3200
```

#### worker (非推奨)

`ai-worker` のエイリアス。互換性のため残されています。

```bash
bun run cli -- worker  # ai-worker と同等
```

### transcribe

文字起こし

```bash
bun run cli -- transcribe                  # 今日の録音を文字起こし
bun run cli -- transcribe -d 2025-01-01    # 日付指定
bun run cli -- transcribe --watch          # 録音完了を監視して自動実行
```

### interpret

AI 解釈 (interpretedText 生成)

```bash
bun run cli -- interpret                   # 今日の未解釈セグメント
bun run cli -- interpret -d 2025-01-01     # 日付指定
bun run cli -- interpret --all             # 全日付の未解釈セグメント
bun run cli -- interpret --all --force     # 全セグメントを再解釈
```

### summarize

要約生成

```bash
bun run cli -- summarize                   # 全時間帯の要約
bun run cli -- summarize --hour 14         # 特定時間の要約
bun run cli -- summarize --daily           # 日次要約
```

### enroll

話者登録

```bash
bun run cli -- enroll --name "Alice" --audio sample.wav
bun run cli -- enroll --list               # 登録済み話者一覧
bun run cli -- enroll --remove "Alice"     # 話者削除
bun run cli -- enroll --assign             # 未知話者に名前を割り当て
```

---

## 推奨構成

```bash
# ターミナル1: 両 Worker を起動
bun run cli -- workers

# ターミナル2: serve 起動 (APIサーバー + ブラウザ録音 + 要約スケジューラ)
bun run cli -- serve
```

または個別に起動:

```bash
# ターミナル1: AI Worker 起動
bun run cli -- ai-worker

# ターミナル2: Local Worker 起動
bun run cli -- local-worker

# ターミナル3: serve 起動
bun run cli -- serve
```
