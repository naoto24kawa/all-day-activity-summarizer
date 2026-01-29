/**
 * Slack API Client (Stealth Mode)
 *
 * Uses xoxc + xoxd tokens for authentication without requiring admin approval.
 * Note: This is an unofficial method and may break if Slack changes their API.
 */

import consola from "consola";

export interface SlackClientConfig {
  xoxcToken: string;
  xoxdToken: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  is_mpim: boolean;
  is_member: boolean;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
}

export interface SlackMessageAttachment {
  fallback?: string;
  text?: string;
  pretext?: string;
  title?: string;
  title_link?: string;
}

export interface SlackMessage {
  type: string;
  ts: string;
  user?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  attachments?: SlackMessageAttachment[];
  permalink?: string;
}

export interface ConversationsListResponse {
  ok: boolean;
  channels: SlackChannel[];
  response_metadata?: {
    next_cursor?: string;
  };
  error?: string;
}

export interface ConversationsHistoryResponse {
  ok: boolean;
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
  error?: string;
}

export interface SearchMessagesResponse {
  ok: boolean;
  messages: {
    total: number;
    matches: Array<
      SlackMessage & {
        channel: { id: string; name: string };
        permalink: string;
      }
    >;
  };
  error?: string;
}

export interface UsersInfoResponse {
  ok: boolean;
  user?: SlackUser;
  error?: string;
}

export interface AuthTestResponse {
  ok: boolean;
  user_id?: string;
  user?: string;
  team_id?: string;
  team?: string;
  error?: string;
}

const SLACK_API_BASE = "https://slack.com/api";

// Rate limiting: 50 requests per minute for most endpoints
const RATE_LIMIT_DELAY_MS = 1200; // ~50 req/min with safety margin

export class SlackClient {
  private xoxcToken: string;
  private xoxdToken: string;
  private lastRequestTime = 0;
  private userCache = new Map<string, SlackUser>();

  constructor(config: SlackClientConfig) {
    this.xoxcToken = config.xoxcToken;
    this.xoxdToken = config.xoxdToken;
  }

  /**
   * Rate limit aware request
   */
  private async rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < RATE_LIMIT_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS - elapsed));
    }

    this.lastRequestTime = Date.now();
    return fetch(url, options);
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${SLACK_API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await this.rateLimitedFetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.xoxcToken}`,
        Cookie: `d=${this.xoxdToken}`,
      },
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
   * Test authentication
   */
  async testAuth(): Promise<AuthTestResponse> {
    return this.apiRequest<AuthTestResponse>("auth.test");
  }

  /**
   * Get list of conversations (channels, DMs, groups)
   */
  async getConversationsList(
    options: { types?: string; limit?: number; cursor?: string } = {},
  ): Promise<ConversationsListResponse> {
    const params: Record<string, string> = {
      types: options.types || "public_channel,private_channel,mpim,im",
      limit: String(options.limit || 200),
    };

    if (options.cursor) {
      params.cursor = options.cursor;
    }

    return this.apiRequest<ConversationsListResponse>("conversations.list", params);
  }

  /**
   * Get conversation history
   */
  async getConversationsHistory(
    channelId: string,
    options: {
      limit?: number;
      cursor?: string;
      oldest?: string;
      latest?: string;
    } = {},
  ): Promise<ConversationsHistoryResponse> {
    const params: Record<string, string> = {
      channel: channelId,
      limit: String(options.limit || 100),
    };

    if (options.cursor) {
      params.cursor = options.cursor;
    }
    if (options.oldest) {
      params.oldest = options.oldest;
    }
    if (options.latest) {
      params.latest = options.latest;
    }

    return this.apiRequest<ConversationsHistoryResponse>("conversations.history", params);
  }

  /**
   * Search for messages (e.g., mentions)
   */
  async searchMessages(
    query: string,
    options: {
      count?: number;
      page?: number;
      sort?: "score" | "timestamp";
      sort_dir?: "asc" | "desc";
    } = {},
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

    return this.apiRequest<SearchMessagesResponse>("search.messages", params);
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: string): Promise<SlackUser | null> {
    // Check cache first
    const cached = this.userCache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.apiRequest<UsersInfoResponse>("users.info", {
        user: userId,
      });

      if (response.user) {
        this.userCache.set(userId, response.user);
        return response.user;
      }
      return null;
    } catch (error) {
      consola.warn(`Failed to get user info for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get channel info
   */
  async getConversationInfo(channelId: string): Promise<{ id: string; name: string } | null> {
    try {
      const response = await this.apiRequest<{
        ok: boolean;
        channel?: { id: string; name?: string; user?: string };
      }>("conversations.info", { channel: channelId });

      if (response.channel) {
        return {
          id: response.channel.id,
          name: response.channel.name || response.channel.user || channelId,
        };
      }
      return null;
    } catch (error) {
      consola.warn(`Failed to get channel info for ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Get message permalink
   */
  async getPermalink(channelId: string, messageTs: string): Promise<string | null> {
    try {
      const response = await this.apiRequest<{
        ok: boolean;
        permalink?: string;
      }>("chat.getPermalink", {
        channel: channelId,
        message_ts: messageTs,
      });

      return response.permalink || null;
    } catch {
      return null;
    }
  }
}

/**
 * Create Slack client from config
 */
export function createSlackClient(config: {
  xoxcToken?: string;
  xoxdToken?: string;
}): SlackClient | null {
  if (!config.xoxcToken || !config.xoxdToken) {
    return null;
  }

  return new SlackClient({
    xoxcToken: config.xoxcToken,
    xoxdToken: config.xoxdToken,
  });
}
