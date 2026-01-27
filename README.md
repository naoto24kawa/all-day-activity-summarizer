# Hono + React SPA Project Template

モダンなフルスタックWebアプリケーション開発のための包括的なプロジェクトテンプレートです。Hono（バックエンド）、React（フロントエンド）、Bun、Tailwind CSS 4、shadcn/uiを組み合わせ、開発効率と保守性を両立させた環境を提供します。

## 📖 目次

- [プロジェクト概要](#プロジェクト概要)
- [技術スタック](#技術スタック)
- [セットアップ](#セットアップ)
- [テンプレート利用時の初期設定](#テンプレート利用時の初期設定)
- [利用可能なコマンド](#利用可能なコマンド)
- [アーキテクチャ](#アーキテクチャ)
- [開発ワークフロー](#開発ワークフロー)
- [CI/CD](#cicd)
- [トラブルシューティング](#トラブルシューティング)
- [関連リソース](#関連リソース)

## 🎯 プロジェクト概要

Hono（バックエンド）+ React（フロントエンド）+ Bun + Vite + Tailwind CSS 4 + shadcn/uiを使用したフルスタックWebアプリケーションテンプレート。

**主な特徴:**
- React SPAとHono APIの明確な分離
- 型安全性とコード品質管理が標準装備
- Cloudflare Pages/Workersへのデプロイ対応
- Git Hooks、テスト、CI/CDを含む完全な開発環境

## 🚀 技術スタック

### バックエンド
- **[Hono](https://hono.dev/)** - 軽量で高速なWebフレームワーク
- **[Bun](https://bun.sh)** - JavaScriptランタイム

### フロントエンド
- **[React](https://react.dev/)** 19 - UIライブラリ
- **[Vite](https://vite.dev/)** - 高速ビルドツール・開発サーバー
- **[Tailwind CSS](https://tailwindcss.com/)** v4 - CSSフレームワーク
- **[shadcn/ui](https://ui.shadcn.com/)** - 再利用可能なUIコンポーネント

### 開発ツール
- **[TypeScript](https://www.typescriptlang.org/)** - 静的型付け
- **[Biome](https://biomejs.dev/)** - リント・フォーマットツール
- **[Playwright](https://playwright.dev/)** - E2Eテスト
- **[Storybook](https://storybook.js.org/)** - UIコンポーネント開発環境
- **[Lefthook](https://github.com/evilmartians/lefthook)** - Git Hooks管理

### デプロイ
- **[Cloudflare Pages/Workers](https://developers.cloudflare.com/)** - エッジコンピューティング

## 📦 セットアップ

### 前提条件

- **Bun** v1.1.44以上

```bash
# Bunのインストール（未インストールの場合）
curl -fsSL https://bun.sh/install | bash
```

### インストール

```bash
# 依存関係のインストール
bun install

# 開発サーバーの起動
bun run dev
```

サーバーは http://localhost:5173 で起動します。

### 初期セットアップの確認

```bash
# コード品質チェック
bun run lint

# テスト実行
bun run test

# ビルド確認
bun run build
```

## ⚙️ テンプレート利用時の初期設定

このテンプレートを使って新規プロジェクトを作成する際は、以下の設定を必ず更新してください。

### 1. プロジェクト名の変更

#### package.json

```json
{
  "name": "init-project",  // ← あなたのプロジェクト名に変更
  ...
}
```

#### wrangler設定ファイル

このプロジェクトでは、React SPAとHono APIを分離してデプロイするため、2つの設定ファイルがあります:

**apps/frontend/wrangler.jsonc（Cloudflare Pages用 - React SPA）**:
```jsonc
{
  "name": "hono-react-pages",  // ← Pagesプロジェクト名に変更
  "pages_build_output_dir": "dist"
}
```

**apps/backend/wrangler.jsonc（Cloudflare Workers用 - Hono API）**:
```jsonc
{
  "name": "hono-api-worker",  // ← Worker名に変更
  "main": "src/index.ts",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"]
}
```

### 2. .gitignoreファイルのセットアップ

```bash
# .gitignore.example をコピー
cp .gitignore.example .gitignore
```

### 3. 環境変数の設定

バックエンド開発用の環境変数を設定します（wrangler dev が自動的に読み込みます）:

```bash
# apps/backend/.dev.vars を編集
# すでにテンプレート実装例の環境変数が含まれています
```

**必須の環境変数** (使用する場合):

- `SESSION_SECRET` - セッション暗号化キー
  ```bash
  # 生成方法
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

**注意**: `apps/backend/.dev.vars`ファイルは`.gitignore`に含まれており、Gitにコミットされません。

### 4. GitHub Secrets の設定（CI/CD用）

自動デプロイを有効にする場合は、GitHubリポジトリに以下のシークレットを設定してください:

**リポジトリ設定**: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

| シークレット名 | 説明 | 取得方法 |
|--------------|------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare APIトークン | [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) → `Create Token` → "Edit Cloudflare Workers" テンプレート |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID | Cloudflare Dashboard → Workers & Pages → URLから確認 |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | Cloudflare Pagesプロジェクト名 | `apps/frontend/wrangler.jsonc`の`name`と同じ値 |
| `CLOUDFLARE_WORKERS_PROJECT_NAME` | Cloudflare Workersプロジェクト名 | `apps/backend/wrangler.jsonc`の`name`と同じ値 |

### 5. Cloudflareへのデプロイ

```bash
# Cloudflareにログイン（初回のみ）
bunx wrangler login

# React SPAをCloudflare Pagesにデプロイ
bun run deploy:pages

# Hono APIをCloudflare Workersにデプロイ
bun run deploy:workers

# 両方をまとめてデプロイ
bun run deploy
```

### チェックリスト

新規プロジェクト作成時に以下を確認してください:

- [ ] `package.json`のプロジェクト名を変更
- [ ] `apps/frontend/wrangler.jsonc`のPagesプロジェクト名を変更
- [ ] `apps/backend/wrangler.jsonc`のWorker名を変更
- [ ] `.gitignore.example`を`.gitignore`にコピー
- [ ] `apps/backend/.dev.vars`の環境変数を必要に応じて設定
- [ ] GitHub Secretsを設定（CI/CD使用時）
- [ ] Cloudflare PagesとWorkersプロジェクトをデプロイ
- [ ] プロダクション環境変数をCloudflare Dashboardで設定
- [ ] `bun install`で依存関係をインストール
- [ ] `bun run dev`で開発サーバーが起動することを確認（フロントエンド）
- [ ] `bun run dev:backend`でバックエンドサーバーが起動することを確認
- [ ] `bun run build`でビルドが成功することを確認

## 🛠️ 利用可能なコマンド

### 開発コマンド

```bash
# Vite開発サーバー起動（React SPA、ホットリロード有効）
bun run dev

# Cloudflare Workers ローカル環境で Hono サーバー起動（wrangler dev）
bun run dev:backend

# プロダクションビルド
bun run build

# ビルド結果のプレビュー
bun run preview
```

### コード品質

```bash
# Biomeでコードをチェック
bun run lint

# Biomeで自動修正（安全な修正+unsafe修正）
bun run lint:fix

# Biomeでコードをフォーマット
bun run format
```

### テスト

```bash
# E2Eテストを実行（ヘッドレスモード）
bun run test

# Playwright UIモードで実行（インタラクティブ）
bun run test:ui

# ブラウザ表示ありでテスト実行（デバッグ用）
bun run test:headed
```

### Storybook

```bash
# Storybookを起動（http://localhost:6006）
bun run storybook

# Storybookを静的ビルド
bun run build-storybook
```

### shadcn/uiコンポーネント

```bash
# コンポーネントを追加
bunx shadcn add button
bunx shadcn add card
bunx shadcn add form

# 利用可能なコンポーネント一覧を確認
bunx shadcn add
```

### Cloudflareデプロイ

```bash
# React SPAをCloudflare Pagesにデプロイ
bun run deploy:pages

# Hono APIをCloudflare Workersにデプロイ
bun run deploy:workers

# 両方をまとめてデプロイ
bun run deploy
```

## 🏗️ アーキテクチャ

### ディレクトリ構造（モノレポ構成）

```
.
├── apps/
│   ├── frontend/              # React SPA
│   │   ├── src/
│   │   │   ├── client/       # App entry point
│   │   │   ├── components/   # UI components
│   │   │   │   ├── ui/       # shadcn/ui components
│   │   │   │   └── app/      # App-specific components
│   │   │   ├── lib/          # Frontend utilities
│   │   │   └── styles/       # Global styles
│   │   ├── e2e/              # Playwright tests
│   │   ├── public/           # Static assets
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── backend/               # Hono API
│       ├── src/
│       │   └── index.ts      # Server entry (AppType export)
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.jsonc
│
├── packages/
│   └── types/                 # 共有型定義
│       ├── src/
│       │   ├── index.ts      # Main export
│       │   ├── env.ts        # Environment types
│       │   └── api.ts        # API types
│       ├── package.json
│       └── tsconfig.json
│
├── package.json               # Root (workspaces設定)
├── tsconfig.base.json         # Base TypeScript config
└── tsconfig.json              # TypeScript Project References
```

### アーキテクチャ概要

**フロントエンド開発（`bun run dev`）**:
- Viteが`apps/frontend/index.html`を配信
- `apps/frontend/src/client/index.tsx`をエントリーポイントとしてReact SPAをレンダリング
- HMR（Hot Module Replacement）が有効で高速な開発体験
- ポート: http://localhost:5173

**バックエンド開発（`bun run dev:backend`）**:
- wrangler dev で Cloudflare Workers ローカル環境を起動
- `apps/backend/src/index.ts` をエントリーポイント
- ポート: http://localhost:8787（wrangler dev のデフォルト）

**本番ビルド（`bun run build`）**:
- Viteが`apps/frontend/dist/`にバンドル済みファイルを出力
- Cloudflare Pagesにデプロイして静的ファイルとして配信

**Hono APIサーバー（`apps/backend/src/index.ts`）**:
- 開発時は wrangler dev でローカル実行
- APIエンドポイントの追加が可能
- Cloudflare Workersとして動作（プロダクション時）

### レンダリングフロー

1. **開発時**: Vite → `apps/frontend/index.html` → React SPAレンダリング
2. **本番時**: Cloudflare Pages → `apps/frontend/dist/index.html`（ビルド済み）

### ルーティング

- 現在はシンプルな単一ページSPA構成
- クライアントサイドルーティングが必要な場合は、React Routerなどを追加可能
- Honoでサーバーサイドのルート定義が可能（`apps/backend/src/index.ts`）

### スタイリング

- Tailwind CSS 4を使用
- `cn()`ヘルパー関数（`src/lib/utils.ts`）でクラス名の結合
- shadcn/uiコンポーネントは`src/components/ui/`に配置

### TypeScript設定

- **厳格モード**: 有効（`strict: true`）
- **モジュール解決**: Bundlerモード（`moduleResolution: "bundler"`）
- **JSX**: `react-jsx`
- **パスエイリアス**: `@/` → `src/`
- **Cloudflare Workers型**: `@cloudflare/workers-types`を使用

#### 環境変数の型定義（`src/types/env.ts`）

Cloudflare Workers環境変数とバインディングの型を定義:

```typescript
export interface Env {
  // 環境変数（必要に応じて追加）
  SESSION_SECRET?: string;
  API_KEY?: string;

  // Cloudflareバインディング（使用する場合はコメント解除）
  // MY_KV?: KVNamespace;
  // MY_BUCKET?: R2Bucket;
  // DB?: D1Database;
}
```

**Honoでの使用例**:

```typescript
import { Hono } from 'hono'
import type { Env } from '../types/env'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/data', (c) => {
  const secret = c.env.SESSION_SECRET  // 型安全
  // KV、R2、D1などのバインディングも型安全に利用可能
  return c.json({ message: 'Success' })
})
```

## コード品質管理（Biome）

このプロジェクトではBiomeをlinter・formatterとして使用しています。

### 重要なルール

- **button要素のtype属性**: 必須（`useButtonType: error`）
- **配列indexをkeyに使用**: 禁止（`noArrayIndexKey: error`）
- **any型の使用**: 警告（テストファイルは例外）

### フォーマット

- セミコロン: 常に付与
- 引用符: ダブルクォート
- 末尾カンマ: 常に付与
- 行幅: 100文字

### 既知の制限

CSSファイル（`src/styles/globals.css`）はTailwind CSSのディレクティブ（`@tailwind`、`@apply`）を含むため、Biomeでパースエラーが表示されますが、実際の動作には影響ありません。

## 👨‍💻 開発ワークフロー

### Git Hooks（Lefthook）

以下のGit Hooksが自動実行されます:

- **pre-commit**: Biomeでリント・フォーマット（自動修正）
- **pre-push**: リントチェック、テスト実行、ビルド確認

詳細は`lefthook.yml`を参照してください。

**フックのスキップ**（緊急時のみ）:
```bash
LEFTHOOK=0 git commit -m "fix: urgent hotfix"
```

### Hono APIの追加方法

`src/server/index.ts`でAPIエンドポイントを追加:

```typescript
// JSONレスポンス
app.get('/api/hello', (c) => {
  return c.json({ message: 'Hello from Hono!' })
})

// 環境変数の利用
app.get('/api/config', (c) => {
  const secret = c.env.SESSION_SECRET
  return c.json({ hasSecret: !!secret })
})

// ミドルウェアの使用例
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

app.use('*', logger())
app.use('/api/*', cors())
```

## 🧪 テスト & 開発

### E2Eテスト（Playwright）

テストファイルは`e2e/`配下に配置します。実行コマンドは「利用可能なコマンド」セクションを参照してください。

### Storybook

UIコンポーネントの開発・ドキュメント化に使用します。

```bash
bun run storybook  # http://localhost:6006 で起動
```

## 🚢 CI/CD

### GitHub Actions

- **CI**: `.github/workflows/ci.yml` - リント、ビルド、テストを自動実行
- **CD**: `.github/workflows/deploy.yml` - mainブランチへのマージ時にCloudflare Pagesへ自動デプロイ

**必要なGitHub Secrets**:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PROJECT_NAME`

詳細は「テンプレート利用時の初期設定」セクションを参照してください。

## 🐛 トラブルシューティング

### ポートが既に使用されている

```bash
# プロセスを確認
lsof -i :5173

# プロセスを終了
kill -9 <PID>
```

### キャッシュのクリア

```bash
# Bunキャッシュをクリア
bun pm cache rm

# node_modulesを削除して再インストール
rm -rf node_modules bun.lockb
bun install
```

### Playwrightブラウザのインストール

```bash
bunx playwright install
```

### Git Hooksが動作しない

```bash
# Lefthookを再インストール
bunx lefthook install

# フックの実行を確認
bunx lefthook run pre-commit
```

## 📚 関連リソース

- [Hono Documentation](https://hono.dev/)
- [React Documentation](https://react.dev/)
- [Bun Documentation](https://bun.sh/docs)
- [Vite Documentation](https://vite.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Biome Documentation](https://biomejs.dev/guides/getting-started/)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Storybook Documentation](https://storybook.js.org/docs)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

## 📝 ライセンス

MIT License
