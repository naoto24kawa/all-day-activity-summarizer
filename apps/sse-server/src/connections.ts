/**
 * SSE Connection Manager
 *
 * 全クライアントの SSE 接続を管理し、イベントをブロードキャスト
 */

import consola from "consola";
import type { SSEStreamingApi } from "hono/streaming";

interface Client {
  id: string;
  stream: SSEStreamingApi;
  connectedAt: Date;
}

class ConnectionManager {
  private clients = new Map<string, Client>();

  /**
   * クライアントを追加
   */
  add(clientId: string, stream: SSEStreamingApi): void {
    this.clients.set(clientId, {
      id: clientId,
      stream,
      connectedAt: new Date(),
    });
    consola.debug(`SSE client connected: ${clientId} (total: ${this.clients.size})`);
  }

  /**
   * クライアントを削除
   */
  remove(clientId: string): void {
    this.clients.delete(clientId);
    consola.debug(`SSE client disconnected: ${clientId} (total: ${this.clients.size})`);
  }

  /**
   * 接続中のクライアント数を取得
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 全クライアントにイベントをブロードキャスト
   */
  async broadcast(event: string, data: unknown): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    const payload = typeof data === "string" ? data : JSON.stringify(data);

    for (const [clientId, client] of this.clients) {
      try {
        await client.stream.writeSSE({
          event,
          data: payload,
        });
        sent++;
      } catch (error) {
        consola.warn(`Failed to send to client ${clientId}:`, error);
        failed++;
        // 失敗したクライアントは削除
        this.remove(clientId);
      }
    }

    if (sent > 0 || failed > 0) {
      consola.debug(`Broadcast event '${event}': sent=${sent}, failed=${failed}`);
    }

    return { sent, failed };
  }
}

// シングルトンインスタンス
export const connectionManager = new ConnectionManager();
