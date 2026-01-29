/**
 * Claude Code MCP Client
 *
 * Connects to claude-json-reporter-mcp-server to fetch Claude Code history
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import consola from "consola";

export interface ClaudeCodeProject {
  path: string;
  sessionCount: number;
}

export interface ClaudeCodeSessionInfo {
  sessionId: string;
  updatedAt: string;
}

export interface ClaudeCodeSessionDetail {
  sessionId: string;
  summary: {
    userMessageCount: number;
    assistantMessageCount: number;
    toolUseCount: number;
    startTime: string | null;
    endTime: string | null;
  };
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: string;
    toolUse?: Array<{ name: string }>;
  }>;
}

export class ClaudeCodeClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private serverPath: string;

  constructor(serverPath = "claude-json-reporter-mcp-server") {
    this.serverPath = serverPath;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      this.transport = new StdioClientTransport({
        command: "npx",
        args: [this.serverPath],
      });

      this.client = new Client(
        {
          name: "adas-claude-code-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      await this.client.connect(this.transport);
      consola.debug("[ClaudeCode] MCP client connected");
    } catch (error) {
      consola.error("[ClaudeCode] Failed to connect MCP client:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    consola.debug("[ClaudeCode] MCP client disconnected");
  }

  async listProjects(): Promise<ClaudeCodeProject[]> {
    if (!this.client) {
      throw new Error("Client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "list_projects",
        arguments: {},
      });

      // Parse the tool result
      const content = result.content;
      if (!Array.isArray(content) || content.length === 0) {
        return [];
      }

      const textContent = content.find((c) => c.type === "text");
      if (!textContent || typeof textContent.text !== "string") {
        return [];
      }

      const parsed = JSON.parse(textContent.text);
      return parsed.projects || [];
    } catch (error) {
      consola.error("[ClaudeCode] Failed to list projects:", error);
      throw error;
    }
  }

  async listSessions(projectPath: string): Promise<ClaudeCodeSessionInfo[]> {
    if (!this.client) {
      throw new Error("Client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "list_sessions",
        arguments: { project_path: projectPath },
      });

      const content = result.content;
      if (!Array.isArray(content) || content.length === 0) {
        return [];
      }

      const textContent = content.find((c) => c.type === "text");
      if (!textContent || typeof textContent.text !== "string") {
        return [];
      }

      const parsed = JSON.parse(textContent.text);
      return parsed.sessions || [];
    } catch (error) {
      consola.error(`[ClaudeCode] Failed to list sessions for ${projectPath}:`, error);
      throw error;
    }
  }

  async getSessionDetail(projectPath: string, sessionId: string): Promise<ClaudeCodeSessionDetail> {
    if (!this.client) {
      throw new Error("Client not connected");
    }

    try {
      const result = await this.client.callTool({
        name: "get_session_detail",
        arguments: {
          project_path: projectPath,
          session_id: sessionId,
        },
      });

      const content = result.content;
      if (!Array.isArray(content) || content.length === 0) {
        throw new Error("Empty response");
      }

      const textContent = content.find((c) => c.type === "text");
      if (!textContent || typeof textContent.text !== "string") {
        throw new Error("No text content in response");
      }

      return JSON.parse(textContent.text);
    } catch (error) {
      consola.error(`[ClaudeCode] Failed to get session detail for ${sessionId}:`, error);
      throw error;
    }
  }
}

export function createClaudeCodeClient(serverPath?: string): ClaudeCodeClient {
  return new ClaudeCodeClient(serverPath);
}
