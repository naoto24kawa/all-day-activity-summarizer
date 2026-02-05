/**
 * Slack API Client (Stealth Mode)
 *
 * Uses xoxc + xoxd tokens for authentication without requiring admin approval.
 * Note: This is an unofficial method and may break if Slack changes their API.
 */

import type {
  AuthTestResponse,
  BotsInfoResponse,
  ChatPostMessageResponse,
  ConversationsHistoryOptions,
  ConversationsHistoryResponse,
  ConversationsListOptions,
  ConversationsListResponse,
  ConversationsRepliesOptions,
  ConversationsRepliesResponse,
  FilesInfoResponse,
  PostMessageOptions,
  ReactionsAddResponse,
  ReactionsRemoveResponse,
  SearchMessagesOptions,
  SearchMessagesResponse,
  SlackBot,
  SlackChannel,
  SlackClientConfig,
  SlackFile,
  SlackUser,
  UsersInfoResponse,
} from "./types.js";

const SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_RATE_LIMIT_DELAY_MS = 1200; // ~50 req/min with safety margin

export class SlackClient {
  private xoxcToken: string;
  private xoxdToken: string;
  private rateLimitDelayMs: number;
  private lastRequestTime = 0;

  // Caches
  private userCache = new Map<string, SlackUser>();
  private botCache = new Map<string, SlackBot>();
  private channelCache = new Map<string, SlackChannel>();

  constructor(config: SlackClientConfig) {
    this.xoxcToken = config.xoxcToken;
    this.xoxdToken = config.xoxdToken;
    this.rateLimitDelayMs = config.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_DELAY_MS;
  }

  // ============================================
  // Private: HTTP Request Helpers
  // ============================================

  /**
   * Rate limit aware fetch
   */
  private async rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.rateLimitDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitDelayMs - elapsed));
    }

    this.lastRequestTime = Date.now();
    return fetch(url, options);
  }

  /**
   * Common headers for authentication
   */
  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.xoxcToken}`,
      Cookie: `d=${this.xoxdToken}`,
    };
  }

  /**
   * Make GET request
   */
  private async apiGet<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${SLACK_API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await this.rateLimitedFetch(url.toString(), {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as T & { ok: boolean; error?: string };

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error || "Unknown error"}`);
    }

    return data;
  }

  /**
   * Make POST request (form-urlencoded)
   */
  private async apiPost<T>(endpoint: string, body: Record<string, string>): Promise<T> {
    const url = `${SLACK_API_BASE}/${endpoint}`;

    const response = await this.rateLimitedFetch(url, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as T & { ok: boolean; error?: string };

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error || "Unknown error"}`);
    }

    return data;
  }

  // ============================================
  // Authentication
  // ============================================

  /**
   * Test authentication
   */
  async testAuth(): Promise<AuthTestResponse> {
    return this.apiGet<AuthTestResponse>("auth.test");
  }

  // ============================================
  // Conversations (Channels, DMs, Groups)
  // ============================================

  /**
   * Get list of conversations
   */
  async getConversationsList(
    options: ConversationsListOptions = {},
  ): Promise<ConversationsListResponse> {
    const params: Record<string, string> = {
      types: options.types || "public_channel,private_channel,mpim,im",
      limit: String(options.limit || 200),
    };

    if (options.cursor) {
      params.cursor = options.cursor;
    }

    const response = await this.apiGet<ConversationsListResponse>("conversations.list", params);

    // Cache channels
    for (const channel of response.channels) {
      this.channelCache.set(channel.id, channel);
    }

    return response;
  }

  /**
   * Get conversation history
   */
  async getConversationsHistory(
    channelId: string,
    options: ConversationsHistoryOptions = {},
  ): Promise<ConversationsHistoryResponse> {
    const params: Record<string, string> = {
      channel: channelId,
      limit: String(options.limit || 100),
    };

    if (options.cursor) params.cursor = options.cursor;
    if (options.oldest) params.oldest = options.oldest;
    if (options.latest) params.latest = options.latest;
    if (options.inclusive) params.inclusive = "true";

    return this.apiGet<ConversationsHistoryResponse>("conversations.history", params);
  }

  /**
   * Get thread replies
   */
  async getConversationsReplies(
    channelId: string,
    threadTs: string,
    options: ConversationsRepliesOptions = {},
  ): Promise<ConversationsRepliesResponse> {
    const params: Record<string, string> = {
      channel: channelId,
      ts: threadTs,
      limit: String(options.limit || 100),
    };

    if (options.cursor) params.cursor = options.cursor;
    if (options.oldest) params.oldest = options.oldest;
    if (options.latest) params.latest = options.latest;

    return this.apiGet<ConversationsRepliesResponse>("conversations.replies", params);
  }

  /**
   * Get channel info
   */
  async getConversationInfo(channelId: string): Promise<SlackChannel | null> {
    // Check cache first
    const cached = this.channelCache.get(channelId);
    if (cached) return cached;

    try {
      const response = await this.apiGet<{ ok: boolean; channel: SlackChannel }>(
        "conversations.info",
        {
          channel: channelId,
        },
      );

      if (response.channel) {
        this.channelCache.set(channelId, response.channel);
        return response.channel;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ============================================
  // Search
  // ============================================

  /**
   * Search for messages
   */
  async searchMessages(
    query: string,
    options: SearchMessagesOptions = {},
  ): Promise<SearchMessagesResponse> {
    const params: Record<string, string> = {
      query,
      count: String(options.count || 50),
      sort: options.sort || "timestamp",
      sort_dir: options.sort_dir || "desc",
    };

    if (options.page) {
      params.page = String(options.page);
    }

    return this.apiGet<SearchMessagesResponse>("search.messages", params);
  }

  // ============================================
  // Users & Bots
  // ============================================

  /**
   * Get user info
   */
  async getUserInfo(userId: string): Promise<SlackUser | null> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    try {
      const response = await this.apiGet<UsersInfoResponse>("users.info", { user: userId });

      if (response.user) {
        this.userCache.set(userId, response.user);
        return response.user;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get bot info
   */
  async getBotInfo(botId: string): Promise<SlackBot | null> {
    const cached = this.botCache.get(botId);
    if (cached) return cached;

    try {
      const response = await this.apiGet<BotsInfoResponse>("bots.info", { bot: botId });

      if (response.bot) {
        this.botCache.set(botId, response.bot);
        return response.bot;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ============================================
  // Messages: Write Operations
  // ============================================

  /**
   * Post a message to a channel
   */
  async postMessage(
    channelId: string,
    text: string,
    options: PostMessageOptions = {},
  ): Promise<ChatPostMessageResponse> {
    const body: Record<string, string> = {
      channel: channelId,
      text,
    };

    if (options.thread_ts) body.thread_ts = options.thread_ts;
    if (options.reply_broadcast) body.reply_broadcast = "true";
    if (options.unfurl_links !== undefined) body.unfurl_links = String(options.unfurl_links);
    if (options.unfurl_media !== undefined) body.unfurl_media = String(options.unfurl_media);
    if (options.parse) body.parse = options.parse;
    if (options.mrkdwn !== undefined) body.mrkdwn = String(options.mrkdwn);

    return this.apiPost<ChatPostMessageResponse>("chat.postMessage", body);
  }

  /**
   * Get message permalink
   */
  async getPermalink(channelId: string, messageTs: string): Promise<string | null> {
    try {
      const response = await this.apiGet<{ ok: boolean; permalink?: string }>("chat.getPermalink", {
        channel: channelId,
        message_ts: messageTs,
      });

      return response.permalink || null;
    } catch {
      return null;
    }
  }

  // ============================================
  // Reactions
  // ============================================

  /**
   * Add a reaction to a message
   */
  async addReaction(
    channelId: string,
    timestamp: string,
    emoji: string,
  ): Promise<ReactionsAddResponse> {
    // Remove colons if present (e.g., ":thumbsup:" -> "thumbsup")
    const name = emoji.replace(/^:|:$/g, "");

    return this.apiPost<ReactionsAddResponse>("reactions.add", {
      channel: channelId,
      timestamp,
      name,
    });
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(
    channelId: string,
    timestamp: string,
    emoji: string,
  ): Promise<ReactionsRemoveResponse> {
    const name = emoji.replace(/^:|:$/g, "");

    return this.apiPost<ReactionsRemoveResponse>("reactions.remove", {
      channel: channelId,
      timestamp,
      name,
    });
  }

  // ============================================
  // Files
  // ============================================

  /**
   * Get file info
   */
  async getFileInfo(fileId: string): Promise<SlackFile | null> {
    try {
      const response = await this.apiGet<FilesInfoResponse>("files.info", { file: fileId });
      return response.file || null;
    } catch {
      return null;
    }
  }

  /**
   * Download file content
   * Returns the file as ArrayBuffer
   */
  async downloadFile(fileId: string): Promise<{ file: SlackFile; content: ArrayBuffer } | null> {
    const fileInfo = await this.getFileInfo(fileId);
    if (!fileInfo) return null;

    const downloadUrl = fileInfo.url_private_download || fileInfo.url_private;
    if (!downloadUrl) return null;

    const response = await this.rateLimitedFetch(downloadUrl, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const content = await response.arrayBuffer();
    return { file: fileInfo, content };
  }

  // ============================================
  // Cache Management
  // ============================================

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.userCache.clear();
    this.botCache.clear();
    this.channelCache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { users: number; bots: number; channels: number } {
    return {
      users: this.userCache.size,
      bots: this.botCache.size,
      channels: this.channelCache.size,
    };
  }
}

/**
 * Create Slack client from config
 */
export function createSlackClient(config: {
  xoxcToken?: string;
  xoxdToken?: string;
  rateLimitDelayMs?: number;
}): SlackClient | null {
  if (!config.xoxcToken || !config.xoxdToken) {
    return null;
  }

  return new SlackClient({
    xoxcToken: config.xoxcToken,
    xoxdToken: config.xoxdToken,
    rateLimitDelayMs: config.rateLimitDelayMs,
  });
}
