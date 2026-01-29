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

### worker

Worker のみ起動(別マシンで実行可能)

```bash
bun run cli -- worker
bun run cli -- worker -p 3100
```

### serve

APIサーバー + 録音 + 要約スケジューラ

```bash
bun run cli -- serve
bun run cli -- serve -p 8080
```

提供機能:
1. ローカルAPIサーバー(:3001)
2. ブラウザ経由での音声録音(Web UI から操作)
3. 定期要約スケジューラ(ポモドーロ30分 + 1時間ごと + 日終了時)

### transcribe

文字起こし

```bash
bun run cli -- transcribe                  # 今日の録音を文字起こし
bun run cli -- transcribe -d 2025-01-01    # 日付指定
bun run cli -- transcribe --watch          # 録音完了を監視して自動実行
```

### interpret

AI 解釈(interpretedText 生成)

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
# ターミナル1: Worker 起動
bun run cli -- worker

# ターミナル2: serve 起動(APIサーバー + ブラウザ録音 + 要約スケジューラ)
bun run cli -- serve
```
