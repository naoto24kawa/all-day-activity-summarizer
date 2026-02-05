/**
 * Slack Integration Module
 *
 * Re-exports from @repo/slack-api and local implementations
 */

// Re-export from @repo/slack-api
export type {
  ConversationsHistoryOptions,
  ConversationsListOptions,
  ConversationsRepliesOptions,
  PostMessageOptions,
  SearchMessagesOptions,
  SlackBot,
  SlackChannel,
  SlackClientConfig,
  SlackFile,
  SlackMessage,
  SlackMessageAttachment,
  SlackReaction,
  SlackUser,
} from "@repo/slack-api";
export { createSlackClient, SlackClient } from "@repo/slack-api";

// Local implementations
export {
  fetchChannel,
  fetchDM,
  fetchMentions,
  insertMessageIfNotExists,
  processSlackJob,
} from "./fetcher.js";
export type { EnqueueSlackJobOptions, SlackJobType } from "./queue.js";
export {
  cleanupOldSlackJobs,
  dequeueSlackJobs,
  enqueueSlackJob,
  getSlackQueueStats,
  markSlackJobCompleted,
  markSlackJobFailed,
  recoverStaleSlackJobs,
} from "./queue.js";
export { startSlackEnqueueScheduler, startSlackSystem } from "./scheduler.js";
export { startSlackWorker } from "./worker.js";
