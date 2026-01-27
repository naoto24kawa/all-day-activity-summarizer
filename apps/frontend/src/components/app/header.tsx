import { Button } from "@/components/ui/button";

/**
 * アプリケーションヘッダー
 */
export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <span className="text-xl font-bold text-primary-foreground">H</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">Hono + React</h1>
              <p className="text-xs text-muted-foreground">モダンフルスタックテンプレート</p>
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-4">
          <Button variant="ghost" asChild>
            <a href="#features">機能</a>
          </Button>
          <Button variant="ghost" asChild>
            <a href="#demo">デモ</a>
          </Button>
          <Button variant="default" asChild>
            <a
              href="https://github.com/yourusername/hono-react-template"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </Button>
        </nav>
      </div>
    </header>
  );
}
