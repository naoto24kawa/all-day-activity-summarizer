#!/usr/bin/env bun
/**
 * ADAS MCP Server - stdio モード
 *
 * Claude Desktop など stdio ベースのクライアント向けエントリポイント
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);
