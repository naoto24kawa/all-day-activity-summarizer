/**
 * Slack Channel Matcher
 *
 * Calls the Worker RPC to match Slack channels with projects.
 */

import type {
  ChannelProjectMatch,
  ProjectInfo,
  RpcMatchSlackChannelsResponse,
  SlackChannelInfo,
} from "@repo/types";
import consola from "consola";
import { loadConfig } from "../config.js";

/**
 * Match Slack channels with projects using AI
 *
 * @param channels - Array of Slack channel info
 * @param projects - Array of project info
 * @returns Array of channel-project matches
 */
export async function matchSlackChannels(
  channels: SlackChannelInfo[],
  projects: ProjectInfo[],
): Promise<ChannelProjectMatch[]> {
  if (channels.length === 0 || projects.length === 0) {
    return [];
  }

  const config = loadConfig();
  const { url, timeout } = config.worker;

  consola.info(
    `[channel-matcher] Requesting matches from ${url}/rpc/match-slack-channels (${channels.length} channels, ${projects.length} projects)`,
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/rpc/match-slack-channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channels, projects }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Worker returned ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as RpcMatchSlackChannelsResponse;

    consola.info(`[channel-matcher] Found ${result.matches.length} matches`);

    return result.matches;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      consola.warn("[channel-matcher] Request timed out");
    } else {
      consola.warn("[channel-matcher] Failed to get matches:", err);
    }
    // Return empty array on error (don't block other operations)
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
