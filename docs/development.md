# 開発ワークフロー

## 開発コマンド

```bash
# フロントエンド開発サーバー(:5173)
bun run dev

# プロダクションビルド
bun run build
```

## 品質管理

```bash
# Biomeチェック
bun run lint

# 自動修正
bun run lint:fix

# 型チェック
npx tsc --noEmit -p apps/cli/tsconfig.json
npx tsc --noEmit -p apps/worker/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json
```

## shadcn/ui コンポーネント追加

```bash
cd apps/frontend && bunx shadcn add <component>
```

## Git Hooks(Lefthook)

- **pre-commit**: Biomeでリント・フォーマット(自動修正)

## トラブルシューティング

### Vite 開発サーバーがハングする

`bun run dev` 実行後、Vite が起動せずハングすることがある。

**解決策 1: Vite キャッシュをクリア**

```bash
rm -rf apps/frontend/node_modules/.vite
bun run dev
```

**解決策 2: 依存関係を再インストール**

```bash
rm -rf node_modules bun.lock
bun install
bun run dev
```

### ポートが使用中

```bash
# LISTEN しているプロセスを確認
lsof -i :5173 -sTCP:LISTEN  # フロントエンド
lsof -i :3001 -sTCP:LISTEN  # API サーバー
lsof -i :3100 -sTCP:LISTEN  # Worker

# プロセスを停止
kill <PID>
```
