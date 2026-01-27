import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";

type ApiConfig = {
  appName: string;
  appVersion: string;
  apiEndpoint: string;
  timestamp: string;
};

/**
 * API環境変数デモコンポーネント（Hono RPC版）
 *
 * このコンポーネントは、Hono RPC を使用してバックエンド API から環境変数を取得し、
 * SPAに表示するテンプレート実装例です。
 *
 * - APIエンドポイント: GET /api/config
 * - 環境変数: APP_NAME, APP_VERSION, API_ENDPOINT
 * - 型安全性: Hono RPC により、レスポンスの型が自動推論されます
 */
export function ApiConfigDemo() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Hono RPC クライアントを使用（型安全！）
      const response = await apiClient.api.config.$get();

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // レスポンスの型が自動推論される
      const data = await response.json();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>API環境変数デモ</CardTitle>
        <CardDescription>
          Hono APIから環境変数を取得してSPAに表示するテンプレート実装例
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <div className="text-center py-8 text-muted-foreground">読み込み中...</div>}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>エラー: {error}</AlertDescription>
          </Alert>
        )}

        {config && !loading && (
          <div className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">アプリケーション名</div>
                <div className="text-lg font-semibold">{config.appName}</div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">バージョン</div>
                <div className="text-lg font-semibold">{config.appVersion}</div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">APIエンドポイント</div>
                <div className="text-lg font-semibold break-all">{config.apiEndpoint}</div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">タイムスタンプ</div>
                <div className="text-sm font-mono">
                  {new Date(config.timestamp).toLocaleString("ja-JP")}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t">
              <Button onClick={fetchConfig} variant="outline" className="w-full">
                再読み込み
              </Button>
            </div>

            <Alert>
              <AlertDescription className="text-xs">
                <strong>Hono RPC 実装のポイント:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>
                    環境変数は <code className="bg-muted px-1 rounded">apps/backend/.dev.vars</code>{" "}
                    ファイルで設定
                  </li>
                  <li>
                    Hono APIは <code className="bg-muted px-1 rounded">c.env</code> で環境変数を取得
                  </li>
                  <li>
                    React SPAは{" "}
                    <code className="bg-muted px-1 rounded">apiClient.api.config.$get()</code>{" "}
                    で型安全にAPIを呼び出し
                  </li>
                  <li>レスポンスの型が自動推論されるため、TypeScriptの補完が効きます</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
