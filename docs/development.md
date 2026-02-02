# 開発ワークフロー

## UI/UX 実装方針

### キーボードショートカット

**モーダル/ダイアログのOKボタン**

すべてのモーダル/ダイアログでは、OKボタン(送信/確定/登録など)を `Command+Enter` (Mac) / `Ctrl+Enter` (Windows) で実行できるようにする。

**実装パターン**:

```tsx
import { useEffect, useState } from "react";

function MyDialog({ open, onSubmit, onCancel }) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  // Command+Enter (Mac) / Ctrl+Enter (Windows) で送信
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!submitting) {
          handleSubmit();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // ... render
}
```

**対応済みコンポーネント**:

| コンポーネント | ショートカット | 実行アクション |
|---------------|---------------|---------------|
| `feedback-dialog.tsx` | `Cmd/Ctrl+Enter` | フィードバック送信 / 用語登録 |
| `summary-feedback-dialog.tsx` | `Cmd/Ctrl+Enter` | フィードバック送信 |
| `evaluator-feedback-dialog.tsx` | `Cmd/Ctrl+Enter` | フィードバック送信 |

**注意事項**:
- `useEffect` の依存配列は省略(レンダリングごとに再登録)
- `open` が false の場合は早期リターンでリスナーを登録しない
- 送信中(`submitting`)の場合は重複実行を防止

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
npx tsc --noEmit -p apps/ai-worker/tsconfig.json
npx tsc --noEmit -p apps/local-worker/tsconfig.json
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
lsof -i :3001 -sTCP:LISTEN  # CLI API サーバー
lsof -i :3002 -sTCP:LISTEN  # SSE Server
lsof -i :3100 -sTCP:LISTEN  # AI Worker
lsof -i :3200 -sTCP:LISTEN  # Local Worker

# プロセスを停止
kill <PID>
```
