/**
 * Claude Code Integration Module
 *
 * Exports all Claude Code-related functionality
 */

// Re-export from @repo/claude-history for convenience
export type { ProjectInfo, SessionDetail, SessionInfo, SessionMessage } from "@repo/claude-history";
export { getSessionDetail, listProjects, listSessions } from "@repo/claude-history";

export { fetchAllSessions, fetchProjectSessions, processClaudeCodeJob } from "./fetcher.js";
export type { ClaudeCodeJobType, EnqueueClaudeCodeJobOptions } from "./queue.js";
export {
  cleanupOldClaudeCodeJobs,
  dequeueClaudeCodeJobs,
  enqueueClaudeCodeJob,
  getClaudeCodeQueueStats,
  markClaudeCodeJobCompleted,
  markClaudeCodeJobFailed,
  recoverStaleClaudeCodeJobs,
} from "./queue.js";
export { startClaudeCodeEnqueueScheduler, startClaudeCodeSystem } from "./scheduler.js";
export { startClaudeCodeWorker } from "./worker.js";
