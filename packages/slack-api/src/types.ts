/**
 * Slack API Types
 */

// ============================================
// Configuration
// ============================================

export interface SlackClientConfig {
  /** xoxc token (user token from browser) */
  xoxcToken: string;
  /** xoxd token (cookie token from browser) */
  xoxdToken: string;
  /** Rate limit delay in milliseconds (default: 1200ms = ~50 req/min) */
  rateLimitDelayMs?: number;
}

// ============================================
// Channel / Conversation
// ============================================

export interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  is_mpim: boolean;
  is_member: boolean;
  is_private?: boolean;
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
}

// ============================================
// User / Bot
// ============================================

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_48?: string;
  };
}

export interface SlackBot {
  id: string;
  name: string;
  deleted?: boolean;
}

// ============================================
// Message
// ============================================

export interface SlackMessageAttachment {
  fallback?: string;
  text?: string;
  pretext?: string;
  title?: string;
  title_link?: string;
}

export interface SlackReaction {
  name: string;
  count: number;
  users: string[];
}

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
}

export interface SlackMessage {
  type: string;
  ts: string;
  user?: string;
  bot_id?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  attachments?: SlackMessageAttachment[];
  reactions?: SlackReaction[];
  files?: SlackFile[];
  permalink?: string;
}

// ============================================
// API Responses
// ============================================

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

export interface AuthTestResponse extends SlackApiResponse {
  user_id?: string;
  user?: string;
  team_id?: string;
  team?: string;
  url?: string;
}

export interface ConversationsListResponse extends SlackApiResponse {
  channels: SlackChannel[];
  response_metadata?: {
    next_cursor?: string;
  };
}

export interface ConversationsHistoryResponse extends SlackApiResponse {
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
}

export interface ConversationsRepliesResponse extends SlackApiResponse {
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
}

export interface SearchMessagesResponse extends SlackApiResponse {
  messages: {
    total: number;
    matches: Array<
      SlackMessage & {
        channel: { id: string; name: string };
        permalink: string;
      }
    >;
    paging?: {
      count: number;
      total: number;
      page: number;
      pages: number;
    };
  };
}

export interface UsersInfoResponse extends SlackApiResponse {
  user?: SlackUser;
}

export interface BotsInfoResponse extends SlackApiResponse {
  bot?: SlackBot;
}

export interface ChatPostMessageResponse extends SlackApiResponse {
  channel: string;
  ts: string;
  message: SlackMessage;
}

export interface ReactionsAddResponse extends SlackApiResponse {}

export interface ReactionsRemoveResponse extends SlackApiResponse {}

export interface FilesInfoResponse extends SlackApiResponse {
  file: SlackFile;
}

// ============================================
// Request Options
// ============================================

export interface ConversationsListOptions {
  types?: string;
  limit?: number;
  cursor?: string;
}

export interface ConversationsHistoryOptions {
  limit?: number;
  cursor?: string;
  oldest?: string;
  latest?: string;
  inclusive?: boolean;
}

export interface ConversationsRepliesOptions {
  limit?: number;
  cursor?: string;
  oldest?: string;
  latest?: string;
}

export interface SearchMessagesOptions {
  count?: number;
  page?: number;
  sort?: "score" | "timestamp";
  sort_dir?: "asc" | "desc";
}

export interface PostMessageOptions {
  /** Thread timestamp to reply to */
  thread_ts?: string;
  /** Broadcast reply to channel */
  reply_broadcast?: boolean;
  /** Disable link unfurling */
  unfurl_links?: boolean;
  /** Disable media unfurling */
  unfurl_media?: boolean;
  /** Parse mode: 'full' | 'none' */
  parse?: "full" | "none";
  /** Use mrkdwn formatting */
  mrkdwn?: boolean;
}
