import { ApiConfigDemo } from "./api-config-demo";
import { HonoRpcDemo } from "./hono-rpc-demo";

/**
 * API統合デモセクション
 */
export function DemoSection() {
  return (
    <section id="demo" className="container py-16 md:py-24">
      <div className="mb-12 text-center">
        <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">ライブデモ</h2>
        <p className="text-lg text-muted-foreground">
          Hono RPC を使った型安全なAPI通信を実際に体験できます
        </p>
      </div>

      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8">
        <HonoRpcDemo />
        <ApiConfigDemo />
      </div>
    </section>
  );
}
