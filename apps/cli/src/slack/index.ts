/**
 * Slack Integration Module
 *
 * Exports all Slack-related functionality
 */

export type { SlackChannel, SlackClientConfig, SlackMessage, SlackUser } from "./client.js";
export { createSlackClient, SlackClient } from "./client.js";
export { fetchChannel, fetchDM, fetchMentions, processSlackJob } from "./fetcher.js";
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
