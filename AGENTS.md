# AGENTS.md

AI アシスタント向け共通ドキュメント。常に日本語で回答してください。

## プロジェクト概要

**Hono + React モノレポテンプレート** - Cloudflare Pages/Workers 向けフルスタック Web アプリケーション

| カテゴリ | 技術 |
|---------|------|
| バックエンド | Hono + Cloudflare Workers |
| フロントエンド | React 19 + Vite + Tailwind CSS 4 + shadcn/ui |
| テスト | Vitest + Playwright + Storybook |
| ツール | Bun, Biome, Lefthook |

## コマンド

```bash
# 開発（別ターミナルで実行）
bun run dev              # フロントエンド :5173
bun run dev:backend      # バックエンド :8787

# 品質チェック
bun run lint             # Biome チェック
bun run lint:fix         # 自動修正
bun run test             # E2E テスト
bun run test:coverage    # カバレッジ付きテスト
bun run storybook        # Storybook :6006

# デプロイ
bun run deploy           # Pages + Workers デプロイ

# shadcn/ui 追加（apps/frontend で実行）
cd apps/frontend && bunx shadcn add <component>
```

## モノレポ構造

```
apps/
├── frontend/           # React SPA
│   ├── src/
│   │   ├── components/ # UI コンポーネント
│   │   ├── lib/        # api-client.ts, utils.ts
│   │   └── styles/     # グローバルスタイル
│   └── e2e/            # Playwright テスト
└── backend/            # Hono API
    └── src/index.ts    # エントリポイント（AppType export）

packages/
└── types/              # 共有型定義（Env インターフェース等）
```

### ワークスペース依存関係

- **frontend** → `@repo/types`, `@repo/backend`（AppType 参照）
- **backend** → `@repo/types`

## 開発ガイドライン

### テスト

- 機能実装時は対応するテストも実装・更新
- 単体テスト: `*.test.ts(x)` を対象ファイルと同じディレクトリに配置
- E2E: `apps/frontend/e2e/` に配置

### Lint (Biome)

警告レベルのルール（即時対応不要）:
- `noExcessiveCognitiveComplexity`: 複雑度 15 超過
- `noNonNullAssertion`: 非 null アサーション使用
- `useExhaustiveDependencies`: 依存配列不足

## コードレビューの思想

### 評価の観点

1. **SRP**: クラス/関数の責任分離
2. **Code for Humans**: 可読性、保守性
3. **KISS**: シンプルで明確な実装
4. **CoC**: プロジェクト規約への準拠
5. **TypeScript 型安全性**: 適切な型定義、any の排除

### トレードオフの優先順位

```
セキュリティ > 保守性 > パフォーマンス > コード美観
```

### 段階的改善

```
Phase 1: 安全性（セキュリティ、型安全性）
Phase 2: 保守性（SRP、可読性）
Phase 3: パフォーマンス最適化
Phase 4: 美観と規約統一
```

### 優先度判定

| 優先度 | 基準 |
|--------|------|
| Critical | セキュリティ、データ整合性、システム安定性 |
| High | 保守性への大きな影響、将来的なバグのリスク |
| Medium | コード品質向上、規約違反 |
| Low | 最適化、効率化 |

### SRP vs KISS

- 50 行以下 → KISS 優先
- 50-100 行 → 明確に異なる責任がある場合のみ分割
- 100 行以上 → SRP 優先

## GitHub テンプレート

### Issue テンプレート

| テンプレート | 用途 | ラベル |
|-------------|------|--------|
| `feature.yml` | 機能追加 | enhancement |
| `bug.yml` | バグ報告 | bug |
| `task.yml` | リファクタリング、ドキュメント等 | task |

### PR テンプレート

| テンプレート | 用途 |
|-------------|------|
| `PULL_REQUEST_TEMPLATE.md` | 通常の PR |
| `PULL_REQUEST_TEMPLATE/deploy.md` | 本番デプロイ |

## 重要な制約事項

- **TypeScript strict モード必須**: Hono RPC に必要
- **CSS ファイルは Biome 対象外**: Tailwind ディレクティブとの互換性のため
- **shadcn/ui は apps/frontend で実行**: ルートでは正しく動作しない

## ドキュメント

<!-- DELETE_AFTER_SETUP_START -->
**初回セットアップ**: [__docs__/SETUP.md](__docs__/SETUP.md) を参照してください。
<!-- DELETE_AFTER_SETUP_END -->

| ファイル | 内容 |
|----------|------|
| [__docs__/REFERENCE.md](__docs__/REFERENCE.md) | Hono RPC 実装、TypeScript 設定、トラブルシューティング |
