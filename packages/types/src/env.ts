/**
 * Cloudflare Workers環境変数の型定義
 *
 * このファイルでは、Cloudflare Workersで使用する環境変数やバインディングの型を定義します。
 * プロジェクトで使用する環境変数に応じて、このインターフェースを更新してください。
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/
 */
export interface Env {
  // ===========================================================================
  // 環境変数
  // ===========================================================================

  /**
   * セッション暗号化キー
   * @example
   * // .dev.vars（ローカル開発用）
   * SESSION_SECRET=your-32-byte-hex-string
   *
   * // Cloudflare Dashboard（本番環境）
   * Settings → Environment Variables → Add variable
   */
  SESSION_SECRET?: string;

  /**
   * 外部APIキー（例）
   */
  API_KEY?: string;

  /**
   * アプリケーション名（テンプレート実装例）
   * @example
   * // .dev.vars
   * APP_NAME="My Awesome App"
   */
  APP_NAME?: string;

  /**
   * アプリケーションバージョン（テンプレート実装例）
   * @example
   * // .dev.vars
   * APP_VERSION="1.0.0"
   */
  APP_VERSION?: string;

  /**
   * APIエンドポイントURL（テンプレート実装例）
   * @example
   * // .dev.vars
   * API_ENDPOINT="https://api.example.com"
   */
  API_ENDPOINT?: string;

  // ===========================================================================
  // Cloudflare バインディング
  // ===========================================================================

  /**
   * KV Namespace
   * @see https://developers.cloudflare.com/kv/
   * @example
   * // wrangler.toml
   * [[kv_namespaces]]
   * binding = "MY_KV"
   * id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   */
  // MY_KV?: KVNamespace;

  /**
   * R2 Bucket
   * @see https://developers.cloudflare.com/r2/
   * @example
   * // wrangler.toml
   * [[r2_buckets]]
   * binding = "MY_BUCKET"
   * bucket_name = "my-bucket"
   */
  // MY_BUCKET?: R2Bucket;

  /**
   * D1 Database
   * @see https://developers.cloudflare.com/d1/
   * @example
   * // wrangler.toml
   * [[d1_databases]]
   * binding = "DB"
   * database_name = "my-database"
   * database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   */
  // DB?: D1Database;

  /**
   * Durable Object
   * @see https://developers.cloudflare.com/durable-objects/
   * @example
   * // wrangler.toml
   * [[durable_objects.bindings]]
   * name = "MY_DURABLE_OBJECT"
   * class_name = "MyDurableObject"
   */
  // MY_DURABLE_OBJECT?: DurableObjectNamespace;

  /**
   * Queue
   * @see https://developers.cloudflare.com/queues/
   * @example
   * // wrangler.toml
   * [[queues.producers]]
   * binding = "MY_QUEUE"
   * queue = "my-queue"
   */
  // MY_QUEUE?: Queue;

  /**
   * Vectorize Index
   * @see https://developers.cloudflare.com/vectorize/
   * @example
   * // wrangler.toml
   * [[vectorize]]
   * binding = "VECTORIZE_INDEX"
   * index_name = "my-index"
   */
  // VECTORIZE_INDEX?: VectorizeIndex;

  /**
   * AI (Workers AI)
   * @see https://developers.cloudflare.com/workers-ai/
   * @example
   * // wrangler.toml
   * [ai]
   * binding = "AI"
   */
  // AI?: Ai;
}

/**
 * Honoで使用する型定義の例
 *
 * @example
 * import { Hono } from 'hono'
 * import type { Env } from '@/types/env'
 *
 * const app = new Hono<{ Bindings: Env }>()
 *
 * app.get('/api/secret', (c) => {
 *   return c.json({ secret: c.env.SESSION_SECRET })
 * })
 */
