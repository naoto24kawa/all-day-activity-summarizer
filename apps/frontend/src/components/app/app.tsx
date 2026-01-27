import { DemoSection } from "./demo-section";
import { FeaturesSection } from "./features-section";
import { Footer } from "./footer";
import { Header } from "./header";
import { HeroSection } from "./hero-section";

/**
 * メインアプリケーションコンポーネント
 */
export function App() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <HeroSection />
        <FeaturesSection />
        <DemoSection />
      </main>
      <Footer />
    </div>
  );
}
