import { Toaster } from "../ui/sonner";
import { Dashboard } from "./dashboard";

/**
 * メインアプリケーションコンポーネント
 */
export function App() {
  return (
    <div className="min-h-screen bg-background">
      <Dashboard />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
