/**
 * ADAS MCP Server
 *
 * タスク管理・メモ・Slack 機能を Claude Code から利用可能にする MCP サーバー
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoTools } from "./tools/memos.js";
import { registerSlackTools } from "./tools/slack.js";
import { registerTaskTools } from "./tools/tasks.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "adas",
    version: "0.1.0",
  });

  // ツール登録
  registerTaskTools(server);
  registerMemoTools(server);
  registerSlackTools(server);

  return server;
}
