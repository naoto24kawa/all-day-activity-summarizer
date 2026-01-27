import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    title: "Hono RPC",
    description: "型安全なAPI通信を実現。バックエンドの型定義がフロントエンドに自動反映されます。",
    badge: "型安全",
    icon: "🔗",
  },
  {
    title: "Bun Workspaces",
    description: "モノレポ構成で複数のパッケージを効率的に管理。依存関係も明確です。",
    badge: "モノレポ",
    icon: "📦",
  },
  {
    title: "shadcn/ui",
    description: "美しく、アクセシブルなUIコンポーネント。Tailwind CSS 4で簡単にカスタマイズ可能。",
    badge: "UI",
    icon: "🎨",
  },
  {
    title: "Cloudflare対応",
    description: "Cloudflare Pages/Workersへのデプロイ設定済み。エッジで高速に動作します。",
    badge: "デプロイ",
    icon: "☁️",
  },
  {
    title: "開発体験",
    description: "Vite高速開発サーバー、Biomeリント、Playwrightテストなど充実の開発環境。",
    badge: "DX",
    icon: "⚡",
  },
  {
    title: "TypeScript",
    description: "strict モード有効。型安全性を最大限に活用した開発が可能です。",
    badge: "型安全",
    icon: "📘",
  },
];

/**
 * 機能紹介セクション
 */
export function FeaturesSection() {
  return (
    <section id="features" className="container py-16 md:py-24">
      <div className="mb-12 text-center">
        <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">主な機能</h2>
        <p className="text-lg text-muted-foreground">
          モダンなフルスタック開発に必要なすべてが揃っています
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <Card key={feature.title} className="relative overflow-hidden">
            <CardHeader>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-4xl">{feature.icon}</span>
                <Badge variant="outline">{feature.badge}</Badge>
              </div>
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}
