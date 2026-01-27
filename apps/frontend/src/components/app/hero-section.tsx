import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * ヒーローセクション
 */
export function HeroSection() {
  return (
    <section className="container flex flex-col items-center gap-6 py-16 text-center md:py-24">
      <Badge variant="secondary" className="mb-2">
        Bun + Hono + React + shadcn/ui
      </Badge>

      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
        モダンフルスタック
        <br />
        <span className="text-primary">アプリケーション</span>
      </h1>

      <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
        Bun Workspacesを使用したモノレポ構成で、
        <br />
        Hono（バックエンド）+ React（フロントエンド）を統合した
        <br />
        型安全なフルスタックテンプレート
      </p>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Button size="lg" asChild>
          <a href="#demo">デモを見る</a>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <a
            href="https://github.com/yourusername/hono-react-template"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub で見る
          </a>
        </Button>
      </div>
    </section>
  );
}
