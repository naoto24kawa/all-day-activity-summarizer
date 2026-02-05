/**
 * Slack Scheduler
 *
 * Periodically enqueues Slack fetch jobs
 */

import type { AdasDatabase } from "@repo/db";
import { createSlackClient, type SlackClient } from "@repo/slack-api";
import consola from "consola";
import type { AdasConfig } from "../config.js";
import { enqueueSlackJob, getSlackQueueStats } from "./queue.js";
import { startSlackWorker } from "./worker.js";

interface ChannelInfo {
  id: string;
  name: string;
}

/**
 * Fetch all joined channels from Slack
 */
async function fetchAllJoinedChannels(client: SlackClient): Promise<ChannelInfo[]> {
  const channels: ChannelInfo[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.getConversationsList({
      types: "public_channel,private_channel",
      limit: 200,
      cursor,
    });

    for (const channel of response.channels) {
      // Only include channels where user is a member
      if (channel.is_member) {
        channels.push({ id: channel.id, name: channel.name ?? channel.id });
      }
    }

    cursor = response.response_metadata?.next_cursor;
  } while (cursor);

  return channels;
}

/**
 * Convert a glob pattern to regex (supports * wildcard)
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * Check if a channel name matches any exclude pattern
 */
function matchesExcludePattern(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(name));
}

/**
 * Start the Slack scheduler
 */
export function startSlackEnqueueScheduler(
  db: AdasDatabase,
  config: AdasConfig,
  channelIds: string[],
): () => void {
  const intervalMs = config.slack.fetchIntervalMinutes * 60 * 1000;

  const enqueueJobs = () => {
    // Always enqueue mentions fetch
    const mentionsJob = enqueueSlackJob(db, {
      jobType: "fetch_mentions",
    });
    if (mentionsJob) {
      consola.debug("[Slack] Enqueued mentions fetch job");
    }

    // Enqueue keywords fetch if configured
    if (config.slack.watchKeywords && config.slack.watchKeywords.length > 0) {
      const keywordsJob = enqueueSlackJob(db, {
        jobType: "fetch_keywords",
      });
      if (keywordsJob) {
        consola.debug("[Slack] Enqueued keywords fetch job");
      }
    }

    // Enqueue channel fetch jobs
    for (const channelId of channelIds) {
      const channelJob = enqueueSlackJob(db, {
        jobType: "fetch_channel",
        channelId,
      });
      if (channelJob) {
        consola.debug(`[Slack] Enqueued channel fetch job for ${channelId}`);
      }
    }
  };

  // Initial enqueue
  enqueueJobs();

  // Periodic enqueue
  const interval = setInterval(enqueueJobs, intervalMs);

  consola.info(
    `[Slack] Scheduler started (interval: ${config.slack.fetchIntervalMinutes}min, channels: ${channelIds.length})`,
  );

  return () => clearInterval(interval);
}

/**
 * Initialize and start the complete Slack system
 */
export async function startSlackSystem(
  db: AdasDatabase,
  config: AdasConfig,
): Promise<(() => void) | null> {
  if (!config.slack.enabled) {
    consola.debug("[Slack] Disabled in config");
    return null;
  }

  const client = createSlackClient(config.slack);
  if (!client) {
    consola.warn("[Slack] Missing xoxcToken or xoxdToken in config");
    return null;
  }

  // Test authentication and get current user ID
  let currentUserId: string;
  try {
    const auth = await client.testAuth();
    if (!auth.user_id) {
      throw new Error("Failed to get user ID from auth.test");
    }
    currentUserId = auth.user_id;
    consola.success(`[Slack] Authenticated as ${auth.user} (${auth.team})`);
  } catch (error) {
    consola.error("[Slack] Authentication failed:", error);
    return null;
  }

  // Determine which channels to monitor
  let channels: ChannelInfo[];
  if (config.slack.channels.length > 0) {
    // Use configured channels (no name info available)
    channels = config.slack.channels.map((id) => ({ id, name: id }));
    consola.info(`[Slack] Using ${channels.length} configured channels`);
  } else {
    // Fetch all joined channels
    try {
      channels = await fetchAllJoinedChannels(client);
      consola.info(`[Slack] Auto-detected ${channels.length} joined channels`);
    } catch (error) {
      consola.error("[Slack] Failed to fetch channel list:", error);
      channels = [];
    }
  }

  // Apply exclusion filter (supports glob patterns like "rss-*", "*-bot")
  const excludePatterns = config.slack.excludeChannels ?? [];
  if (excludePatterns.length > 0) {
    const excluded: string[] = [];
    channels = channels.filter((ch) => {
      if (matchesExcludePattern(ch.name, excludePatterns)) {
        excluded.push(ch.name);
        return false;
      }
      return true;
    });
    if (excluded.length > 0) {
      consola.info(
        `[Slack] Excluded ${excluded.length} channels: ${excluded.slice(0, 5).join(", ")}${excluded.length > 5 ? "..." : ""}`,
      );
    }
  }

  const channelIds = channels.map((ch) => ch.id);

  // Log queue stats
  const stats = getSlackQueueStats(db);
  consola.debug(`[Slack] Queue stats: ${JSON.stringify(stats)}`);

  // Start scheduler and worker
  const stopScheduler = startSlackEnqueueScheduler(db, config, channelIds);
  const stopWorker = startSlackWorker(db, config, client, currentUserId);

  consola.success("[Slack] System started");

  return () => {
    stopScheduler();
    stopWorker();
    consola.info("[Slack] System stopped");
  };
}
