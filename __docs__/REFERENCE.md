# 技術リファレンス

詳細な実装パターンとトラブルシューティングガイドです。

---

## Hono RPC による型安全な API 通信

### Backend 実装パターン

`apps/backend/src/index.ts`:

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '@repo/types/env'

const app = new Hono<{ Bindings: Env }>()

// CORS設定
app.use('/*', cors())

// GET エンドポイント
app.get('/api/hello', (c) => {
  const name = c.req.query('name') || 'World'
  return c.json({
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString()
  })
})

// 環境変数を使用
app.get('/api/config', (c) => {
  return c.json({
    appName: c.env.APP_NAME || 'Default App',
    appVersion: c.env.APP_VERSION || '1.0.0',
  })
})

// AppType を export（Hono RPC用）
export type AppType = typeof app

export default app
```

### Frontend クライアント

`apps/frontend/src/lib/api-client.ts`:

```typescript
import { hc } from 'hono/client'
import type { AppType } from '@repo/backend'

export const apiClient = hc<AppType>(
  import.meta.env.VITE_API_URL || 'http://localhost:8787'
)
```

### Frontend での使用例

```typescript
import { apiClient } from '@/lib/api-client'

// GET リクエスト
const response = await apiClient.api.hello.$get({
  query: { name: 'Claude' }
})
const data = await response.json()
// data の型が自動推論される
```

### 新しい API endpoint の追加手順

1. `apps/backend/src/index.ts` で endpoint を定義
2. `AppType` が自動的に更新される
3. Frontend で `apiClient` を使用すると型推論が効く

---

## TypeScript 設定

### Base 設定（tsconfig.base.json）

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler",
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": false,
    "exactOptionalPropertyTypes": false
  }
}
```

### 重要な設定の説明

| 設定 | 説明 |
|------|------|
| `strict: true` | Hono RPC に必須 |
| `noUncheckedIndexedAccess` | 配列アクセス時に undefined チェック必須 |
| `noUnusedLocals/Parameters` | 未使用変数・引数をエラーに |

### TypeScript Project References

Root の `tsconfig.json`:

```json
{
  "references": [
    { "path": "./apps/frontend" },
    { "path": "./apps/backend" },
    { "path": "./packages/types" }
  ]
}
```

各ワークスペースの `tsconfig.json` で `composite: true` を設定。

---

## Git Hooks（Lefthook）

### pre-commit

- Biome でリント・フォーマット（自動修正）
- ステージされたファイルのみ対象
- 修正されたファイルは自動的にステージングに追加

### pre-push

- 単体テスト実行
- ビルド確認
- 並列実行（`parallel: true`）

---

## トラブルシューティング

### ワークスペースの依存関係が解決されない

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules bun.lockb
bun install
```

### 型定義が認識されない

```bash
# 各ワークスペースの tsconfig.json で composite: true を確認
# Root の tsconfig.json で references を確認
```

### ビルドエラー

```bash
# フロントエンドのみビルド（エラー特定）
cd apps/frontend && bun run build

# ワークスペース全体の再インストール
bun install
```

### ポート競合

```bash
lsof -i :5173  # フロントエンド
lsof -i :8787  # バックエンド
```

### Cloudflare Pages UTF-8 エラー

```
Invalid commit message, it must be a valid UTF-8 string [code: 8000111]
```

コミットメッセージに絵文字/日本語があると発生。GitHub Actions では `--commit-message="${{ github.sha }}"` で対策。

### Cloudflare リソースの事前作成

`wrangler.jsonc` に追加したリソースはデプロイ前に手動作成が必要:

```bash
bunx wrangler queues create <queue-name>
bunx wrangler kv:namespace create <namespace-name>
bunx wrangler pages project create <project-name> --production-branch=production
```

---

## 参考リンク

- [Bun Workspaces](https://bun.sh/docs/install/workspaces)
- [Hono RPC](https://hono.dev/docs/guides/rpc)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Cloudflare Workers - Monorepos](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
