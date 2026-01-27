# 初回セットアップガイド

このテンプレートから新規プロジェクトを作成する際のセットアップ手順です。

## 1. リポジトリの作成

```bash
# テンプレートからリポジトリを作成（GitHub UI または gh コマンド）
gh repo create your-project-name --template naoto24kawa/hono-react-template --private

# クローン
git clone https://github.com/your-username/your-project-name.git
cd your-project-name
```

## 2. 依存関係のインストール

```bash
bun install
```

## 3. プロジェクト名の変更

### package.json（ルート）

```json
{
  "name": "your-project-name"
}
```

### apps/frontend/wrangler.jsonc

```jsonc
{
  "name": "your-frontend-project-name",
  "pages_build_output_dir": "dist"
}
```

### apps/backend/wrangler.jsonc

```jsonc
{
  "name": "your-api-worker-name",
  "main": "src/index.ts",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"]
}
```

## 4. 環境変数の設定

### ローカル開発用

`apps/backend/.dev.vars` を作成（`.gitignore` に含まれる）:

```bash
SESSION_SECRET=your-secret-key
API_KEY=your-api-key
APP_NAME="Your App Name"
APP_VERSION="1.0.0"
API_ENDPOINT="http://localhost:8787"
```

**SESSION_SECRET の生成**:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 型定義の更新

`packages/types/src/env.ts` で環境変数の型を定義:

```typescript
export interface Env {
  SESSION_SECRET?: string
  API_KEY?: string
  APP_NAME?: string
  APP_VERSION?: string
  API_ENDPOINT?: string

  // Cloudflareバインディング（使用する場合はコメント解除）
  // MY_KV?: KVNamespace
  // MY_BUCKET?: R2Bucket
  // DB?: D1Database
}
```

## 5. Git Hooks の有効化

```bash
bun run prepare  # lefthook install が実行される
```

## 6. Playwright ブラウザのインストール

E2E テスト実行前に必要:

```bash
bunx playwright install
```

## 7. 開発サーバーの起動

```bash
# ターミナル1: フロントエンド
bun run dev

# ターミナル2: バックエンド
bun run dev:backend
```

- フロントエンド: http://localhost:5173
- バックエンド: http://localhost:8787

## 8. 動作確認

1. ブラウザで http://localhost:5173 を開く
2. API が正常に動作しているか確認

---

## GitHub リポジトリ設定

マージコミットの形式とブランチ管理の設定を行います。

```bash
gh api repos/{owner}/{repo} -X PATCH \
  -f merge_commit_title=PR_TITLE \
  -f merge_commit_message=BLANK \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=BLANK \
  -F delete_branch_on_merge=true
```

この設定により:

| 項目 | 効果 |
|------|------|
| Merge/Squash commit | `PRタイトル (#PR番号)` 形式になる |
| Delete branch on merge | マージ後にブランチが自動削除される |

---

## CI/CD セットアップ（GitHub Actions）

### GitHub Secrets の設定

リポジトリの Settings → Secrets and variables → Actions で以下を設定:

| Secret 名 | 説明 |
|-----------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API トークン |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID |

### Cloudflare リソースの事前作成

デプロイ前に Cloudflare 側でリソースを作成:

```bash
# Pages プロジェクト
bunx wrangler pages project create your-frontend-project-name --production-branch=production

# Workers（自動作成されるが、手動で作成する場合）
# bunx wrangler deploy --dry-run で確認
```

### 追加リソースが必要な場合

```bash
# KV Namespace
bunx wrangler kv:namespace create YOUR_KV_NAMESPACE

# R2 Bucket
bunx wrangler r2 bucket create your-bucket-name

# D1 Database
bunx wrangler d1 create your-database-name

# Queue
bunx wrangler queues create your-queue-name
```

作成したリソースの ID を `apps/backend/wrangler.jsonc` に追記してください。

---

## プロダクション環境変数

Cloudflare Dashboard で設定:

1. Workers & Pages → 対象のプロジェクト
2. Settings → Environment Variables
3. 必要な環境変数を追加

---

## チェックリスト

- [ ] プロジェクト名を変更した
- [ ] `apps/backend/.dev.vars` を作成した
- [ ] `bun install` を実行した
- [ ] `bun run prepare` を実行した（Git Hooks）
- [ ] `bunx playwright install` を実行した
- [ ] 開発サーバーが正常に起動する
- [ ] GitHub リポジトリ設定を実行した（マージコミット形式）
- [ ] GitHub Secrets を設定した（CI/CD 使用時）
- [ ] Cloudflare リソースを作成した（デプロイ時）
- [ ] **セットアップ完了処理を実行した（下記参照）**

---

## セットアップ完了処理

全てのチェックが完了したら、CLAUDE.md から初回セットアップへの参照を削除してください。

これにより Claude Code が SETUP.md を参照しなくなり、コンテキストが軽量化されます。

### コマンドで削除

```bash
sed -i '' '/DELETE_AFTER_SETUP_START/,/DELETE_AFTER_SETUP_END/d' CLAUDE.md
```

### 手動で削除

CLAUDE.md から以下の3行を削除:

```markdown
<!-- DELETE_AFTER_SETUP_START -->
**初回セットアップ**: [__docs__/SETUP.md](__docs__/SETUP.md) を参照してください。
<!-- DELETE_AFTER_SETUP_END -->
```

削除後、この変更をコミットしてください:

```bash
git add CLAUDE.md
git commit -m "chore: remove setup reference after initial setup"
```
