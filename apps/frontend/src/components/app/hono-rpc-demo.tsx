import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";

/**
 * Hono RPC デモコンポーネント
 *
 * Hono RPC を使用した型安全なAPI呼び出しのデモンストレーション。
 * クエリパラメータの使用例と型推論の動作を示します。
 */
export function HonoRpcDemo() {
  const [name, setName] = useState("World");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      // Hono RPC クライアントでクエリパラメータ付きリクエスト（型安全！）
      const response = await apiClient.api.hello.$get({
        query: { name },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // レスポンスの型が自動推論される
      const data = await response.json();
      setMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Hono RPC デモ</CardTitle>
        <CardDescription>型安全なAPI呼び出しとクエリパラメータの使用例</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              名前を入力
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="あなたの名前"
              disabled={loading}
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "送信中..." : "挨拶を取得"}
          </Button>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>エラー: {error}</AlertDescription>
          </Alert>
        )}

        {message && !loading && (
          <Alert>
            <AlertDescription className="text-lg font-semibold">{message}</AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertDescription className="text-xs">
            <strong>コード例:</strong>
            <pre className="mt-2 bg-muted p-2 rounded text-xs overflow-x-auto">
              {`const response = await apiClient.api.hello.$get({
  query: { name: "${name}" }
});
const data = await response.json();
// data.message は型推論される！`}
            </pre>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
