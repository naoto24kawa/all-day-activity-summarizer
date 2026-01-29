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
