/**
 * @repo/slack-api
 *
 * Slack API client with stealth mode (xoxc/xoxd) authentication.
 * Can be used without requiring Slack admin approval.
 *
 * @example
 * ```typescript
 * import { SlackClient, createSlackClient } from "@repo/slack-api";
 *
 * const client = new SlackClient({
 *   xoxcToken: "xoxc-...",
 *   xoxdToken: "xoxd-...",
 * });
 *
 * // Read operations
 * const channels = await client.getConversationsList();
 * const history = await client.getConversationsHistory(channelId);
 * const results = await client.searchMessages("from:@user");
 *
 * // Write operations
 * await client.postMessage(channelId, "Hello!");
 * await client.addReaction(channelId, timestamp, "thumbsup");
 *
 * // File operations
 * const file = await client.downloadFile(fileId);
 * ```
 */

export { createSlackClient, SlackClient } from "./client.js";

export type {
  AuthTestResponse,
  BotsInfoResponse,
  ChatPostMessageResponse,
  ConversationsHistoryOptions,
  ConversationsHistoryResponse,
  // Options
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
  // Responses
  SlackApiResponse,
  SlackBot,
  // Entities
  SlackChannel,
  // Config
  SlackClientConfig,
  SlackFile,
  SlackMessage,
  SlackMessageAttachment,
  SlackReaction,
  SlackUser,
  UsersInfoResponse,
} from "./types.js";
