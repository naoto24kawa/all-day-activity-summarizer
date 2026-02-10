#!/usr/bin/env bun
/**
 * ADAS MCP Server Entry Point
 *
 * HTTP (Streamable HTTP) サーバーとして起動し、Claude Code から接続
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.MCP_PORT) || 3050;

// セッション管理
const sessions = new Map<
  string,
  {
    transport: WebStandardStreamableHTTPServerTransport;
    server: ReturnType<typeof createServer>;
  }
>();

Bun.serve({
  port: PORT,
  idleTimeout: 0, // MCP ツール呼び出しが長時間になるためタイムアウト無効
  fetch: async (req) => {
    const url = new URL(req.url);

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", sessions: sessions.size }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // セッション ID を取得
      const sessionId = req.headers.get("mcp-session-id");

      // 既存セッションがあればそれを使用
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        const response = await session.transport.handleRequest(req);
        // CORS ヘッダーを追加
        const newHeaders = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaders)) {
          newHeaders.set(key, value);
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      // 新しいセッション作成 (POST リクエストで初期化)
      if (req.method === "POST" && !sessionId) {
        const server = createServer();
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server });
            console.log(`[mcp-server] Session initialized: ${id}`);
          },
        });

        // サーバーを接続
        await server.connect(transport);

        const response = await transport.handleRequest(req);

        // CORS ヘッダーを追加
        const newHeaders = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaders)) {
          newHeaders.set(key, value);
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      // セッションが見つからない
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
});

console.log(`[mcp-server] ADAS MCP Server listening on http://localhost:${PORT}`);
console.log(`[mcp-server]   POST/GET/DELETE /mcp - MCP endpoint`);
console.log(`[mcp-server]   GET /health          - Health check`);
