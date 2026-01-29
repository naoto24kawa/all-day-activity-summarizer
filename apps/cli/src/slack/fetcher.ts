/**
 * Slack Message Fetcher
 *
 * Handles fetching and storing messages from Slack
 */

import type { AdasDatabase, NewSlackMessage, SlackQueueJob } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { and, eq } from "drizzle-orm";
import type { SlackClient } from "./client.js";

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
 * Resolve user mentions in message text
 * Converts <@U12345678> format to @username format
 */
async function resolveUserMentions(
  client: SlackClient,
  text: string | null | undefined,
): Promise<string | null> {
  if (!text) {
    return text ?? null;
  }

  // Find all user mentions in the format <@UXXXXXXXXX>
  const mentionPattern = /<@(U[A-Z0-9]+)>/g;
  const matches = text.matchAll(mentionPattern);
  const userIds = [...new Set([...matches].map((m) => m[1]))];

  if (userIds.length === 0) {
    return text;
  }

  // Resolve all user IDs to names
  const userMap = new Map<string, string>();
  for (const userId of userIds) {
    const userInfo = await client.getUserInfo(userId);
    if (userInfo) {
      userMap.set(userId, userInfo.real_name || userInfo.name);
    }
  }

  // Replace mentions with names
  let resolvedText = text;
  for (const [userId, userName] of userMap) {
    resolvedText = resolvedText.replace(new RegExp(`<@${userId}>`, "g"), `@${userName}`);
  }

  return resolvedText;
}

/**
 * Convert Slack timestamp to Date string (YYYY-MM-DD)
 */
function tsToDateString(ts: string): string {
  const [seconds] = ts.split(".");
  const date = new Date(Number(seconds) * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Insert message if not exists
 */
function insertMessageIfNotExists(db: AdasDatabase, message: NewSlackMessage): boolean {
  // Check if already exists (using unique constraint on channel_id + message_ts)
  const existing = db
    .select()
    .from(schema.slackMessages)
    .where(
      and(
        eq(schema.slackMessages.channelId, message.channelId),
        eq(schema.slackMessages.messageTs, message.messageTs),
      ),
    )
    .get();

  if (existing) {
    return false;
  }

  try {
    db.insert(schema.slackMessages).values(message).run();
    return true;
  } catch (error) {
    // Unique constraint violation - already exists
    if (String(error).includes("UNIQUE constraint failed")) {
      return false;
    }
    throw error;
  }
}

/**
 * Fetch and store messages from mentions search
 * Searches for direct mentions and group mentions
 */
export async function fetchMentions(
  db: AdasDatabase,
  client: SlackClient,
  currentUserId: string,
  mentionGroups: string[] = [],
  excludePatterns: string[] = [],
): Promise<{ fetched: number; stored: number; excluded: number; lastTs?: string }> {
  // Build search queries: direct mention + group mentions
  const queries = [`to:@${currentUserId}`];
  for (const group of mentionGroups) {
    queries.push(`to:@${group}`);
  }

  let fetched = 0;
  let stored = 0;
  let excluded = 0;
  let lastTs: string | undefined;

  try {
    // Execute all queries
    for (const query of queries) {
      const response = await client.searchMessages(query, {
        count: 50,
        sort: "timestamp",
        sort_dir: "desc",
      });

      for (const match of response.messages.matches) {
        fetched++;
        lastTs = lastTs ? (match.ts > lastTs ? match.ts : lastTs) : match.ts;

        // Skip if channel matches exclude pattern
        if (
          excludePatterns.length > 0 &&
          match.channel.name &&
          matchesExcludePattern(match.channel.name, excludePatterns)
        ) {
          excluded++;
          continue;
        }

        const dateStr = tsToDateString(match.ts);

        // Get user info
        const userInfo = match.user ? await client.getUserInfo(match.user) : null;

        // Resolve user mentions in text
        const resolvedText = await resolveUserMentions(client, match.text);

        const inserted = insertMessageIfNotExists(db, {
          date: dateStr,
          messageTs: match.ts,
          channelId: match.channel.id,
          channelName: match.channel.name,
          userId: match.user || "unknown",
          userName: userInfo?.real_name || userInfo?.name || null,
          messageType: "mention",
          text: resolvedText,
          threadTs: match.thread_ts || null,
          permalink: match.permalink,
          isRead: false,
        });

        if (inserted) {
          stored++;
        }
      }
    }

    consola.debug(
      `Mentions: fetched ${fetched}, excluded ${excluded}, stored ${stored} (queries: ${queries.length})`,
    );
  } catch (error) {
    consola.error("Failed to fetch mentions:", error);
    throw error;
  }

  return { fetched, stored, excluded, lastTs };
}

/**
 * Fetch and store messages matching keywords
 */
export async function fetchKeywords(
  db: AdasDatabase,
  client: SlackClient,
  keywords: string[],
  excludePatterns: string[] = [],
): Promise<{ fetched: number; stored: number; excluded: number; lastTs?: string }> {
  if (keywords.length === 0) {
    return { fetched: 0, stored: 0, excluded: 0 };
  }

  let fetched = 0;
  let stored = 0;
  let excluded = 0;
  let lastTs: string | undefined;

  try {
    for (const keyword of keywords) {
      const response = await client.searchMessages(keyword, {
        count: 50,
        sort: "timestamp",
        sort_dir: "desc",
      });

      for (const match of response.messages.matches) {
        fetched++;
        lastTs = lastTs ? (match.ts > lastTs ? match.ts : lastTs) : match.ts;

        // Skip if channel matches exclude pattern
        if (
          excludePatterns.length > 0 &&
          match.channel.name &&
          matchesExcludePattern(match.channel.name, excludePatterns)
        ) {
          excluded++;
          continue;
        }

        const dateStr = tsToDateString(match.ts);
        const userInfo = match.user ? await client.getUserInfo(match.user) : null;

        // Resolve user mentions in text
        const resolvedText = await resolveUserMentions(client, match.text);

        const inserted = insertMessageIfNotExists(db, {
          date: dateStr,
          messageTs: match.ts,
          channelId: match.channel.id,
          channelName: match.channel.name,
          userId: match.user || "unknown",
          userName: userInfo?.real_name || userInfo?.name || null,
          messageType: "keyword",
          text: resolvedText,
          threadTs: match.thread_ts || null,
          permalink: match.permalink,
          isRead: false,
        });

        if (inserted) {
          stored++;
        }
      }
    }

    consola.debug(
      `Keywords: fetched ${fetched}, excluded ${excluded}, stored ${stored} (keywords: ${keywords.length})`,
    );
  } catch (error) {
    consola.error("Failed to fetch keywords:", error);
    throw error;
  }

  return { fetched, stored, excluded, lastTs };
}

/**
 * Fetch thread replies for a message
 */
async function fetchThreadReplies(
  db: AdasDatabase,
  client: SlackClient,
  channelId: string,
  channelName: string | null,
  threadTs: string,
): Promise<{ fetched: number; stored: number }> {
  let fetched = 0;
  let stored = 0;

  try {
    const response = await client.getConversationsReplies(channelId, threadTs, {
      limit: 100,
    });

    for (const message of response.messages) {
      // Skip the parent message (it has the same ts as threadTs)
      if (message.ts === threadTs) {
        continue;
      }

      // Skip non-user messages
      if (message.type !== "message" || !message.user) {
        continue;
      }

      fetched++;

      const dateStr = tsToDateString(message.ts);
      const userInfo = await client.getUserInfo(message.user);
      const permalink = await client.getPermalink(channelId, message.ts);

      // Resolve user mentions in text
      const resolvedText = await resolveUserMentions(client, message.text);

      const inserted = insertMessageIfNotExists(db, {
        date: dateStr,
        messageTs: message.ts,
        channelId,
        channelName,
        userId: message.user,
        userName: userInfo?.real_name || userInfo?.name || null,
        messageType: "channel",
        text: resolvedText,
        threadTs: message.thread_ts || null,
        permalink,
        isRead: false,
      });

      if (inserted) {
        stored++;
      }
    }
  } catch (error) {
    consola.warn(`Failed to fetch thread replies for ${threadTs}:`, error);
  }

  return { fetched, stored };
}

/**
 * Fetch and store messages from a channel (including thread replies)
 */
export async function fetchChannel(
  db: AdasDatabase,
  client: SlackClient,
  channelId: string,
  oldest?: string,
): Promise<{ fetched: number; stored: number; lastTs?: string }> {
  let fetched = 0;
  let stored = 0;
  let lastTs: string | undefined;

  try {
    // Get channel info first
    const channelInfo = await client.getConversationInfo(channelId);
    const channelName = channelInfo?.name || null;

    const response = await client.getConversationsHistory(channelId, {
      limit: 100,
      oldest,
    });

    // Collect threads to fetch
    const threadsToFetch: string[] = [];

    for (const message of response.messages) {
      // Skip non-user messages (bot messages, system messages, etc.)
      if (message.type !== "message" || !message.user) {
        continue;
      }

      fetched++;
      lastTs = lastTs ? (message.ts > lastTs ? message.ts : lastTs) : message.ts;

      const dateStr = tsToDateString(message.ts);

      // Get user info
      const userInfo = await client.getUserInfo(message.user);

      // Get permalink
      const permalink = await client.getPermalink(channelId, message.ts);

      // Resolve user mentions in text
      const resolvedText = await resolveUserMentions(client, message.text);

      const inserted = insertMessageIfNotExists(db, {
        date: dateStr,
        messageTs: message.ts,
        channelId,
        channelName,
        userId: message.user,
        userName: userInfo?.real_name || userInfo?.name || null,
        messageType: "channel",
        text: resolvedText,
        threadTs: message.thread_ts || null,
        permalink,
        isRead: false,
      });

      if (inserted) {
        stored++;
      }

      // If this message has replies, queue it for thread fetching
      if (message.reply_count && message.reply_count > 0) {
        threadsToFetch.push(message.ts);
      }
    }

    // Fetch thread replies
    for (const threadTs of threadsToFetch) {
      const threadResult = await fetchThreadReplies(db, client, channelId, channelName, threadTs);
      fetched += threadResult.fetched;
      stored += threadResult.stored;
    }

    consola.debug(
      `Channel ${channelId}: fetched ${fetched}, stored ${stored} (threads: ${threadsToFetch.length})`,
    );
  } catch (error) {
    consola.error(`Failed to fetch channel ${channelId}:`, error);
    throw error;
  }

  return { fetched, stored, lastTs };
}

/**
 * Fetch and store messages from a DM
 */
export async function fetchDM(
  db: AdasDatabase,
  client: SlackClient,
  channelId: string,
  oldest?: string,
): Promise<{ fetched: number; stored: number; lastTs?: string }> {
  let fetched = 0;
  let stored = 0;
  let lastTs: string | undefined;

  try {
    const response = await client.getConversationsHistory(channelId, {
      limit: 100,
      oldest,
    });

    for (const message of response.messages) {
      // Skip non-user messages
      if (message.type !== "message" || !message.user) {
        continue;
      }

      fetched++;
      lastTs = lastTs ? (message.ts > lastTs ? message.ts : lastTs) : message.ts;

      const dateStr = tsToDateString(message.ts);

      // Get user info
      const userInfo = await client.getUserInfo(message.user);

      // Get permalink
      const permalink = await client.getPermalink(channelId, message.ts);

      // Resolve user mentions in text
      const resolvedText = await resolveUserMentions(client, message.text);

      const inserted = insertMessageIfNotExists(db, {
        date: dateStr,
        messageTs: message.ts,
        channelId,
        channelName: userInfo?.real_name || userInfo?.name || null,
        userId: message.user,
        userName: userInfo?.real_name || userInfo?.name || null,
        messageType: "dm",
        text: resolvedText,
        threadTs: message.thread_ts || null,
        permalink,
        isRead: false,
      });

      if (inserted) {
        stored++;
      }
    }

    consola.debug(`DM ${channelId}: fetched ${fetched}, stored ${stored}`);
  } catch (error) {
    consola.error(`Failed to fetch DM ${channelId}:`, error);
    throw error;
  }

  return { fetched, stored, lastTs };
}

/**
 * Process a Slack job
 */
export async function processSlackJob(
  db: AdasDatabase,
  client: SlackClient,
  job: SlackQueueJob,
  currentUserId: string,
  mentionGroups: string[] = [],
  watchKeywords: string[] = [],
  excludePatterns: string[] = [],
): Promise<string | undefined> {
  switch (job.jobType) {
    case "fetch_mentions": {
      const result = await fetchMentions(db, client, currentUserId, mentionGroups, excludePatterns);
      return result.lastTs;
    }

    case "fetch_keywords": {
      const result = await fetchKeywords(db, client, watchKeywords, excludePatterns);
      return result.lastTs;
    }

    case "fetch_channel": {
      if (!job.channelId) {
        throw new Error("channelId is required for fetch_channel job");
      }
      const result = await fetchChannel(db, client, job.channelId, job.lastFetchedTs || undefined);
      return result.lastTs;
    }

    case "fetch_dm": {
      if (!job.channelId) {
        throw new Error("channelId is required for fetch_dm job");
      }
      const result = await fetchDM(db, client, job.channelId, job.lastFetchedTs || undefined);
      return result.lastTs;
    }

    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}
