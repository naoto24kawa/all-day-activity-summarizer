/**
 * Match Slack Channels Route
 *
 * Uses Claude to match Slack channels with projects based on channel names.
 */

import { runClaude } from "@repo/core";
import type {
  ChannelProjectMatch,
  RpcMatchSlackChannelsRequest,
  RpcMatchSlackChannelsResponse,
} from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { withProcessingLog } from "../utils/log-processing.js";

const MATCH_CHANNELS_MODEL = "haiku";

export function createMatchSlackChannelsRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<RpcMatchSlackChannelsRequest>();

      if (!body.channels || !Array.isArray(body.channels)) {
        return c.json({ error: "channels is required" }, 400);
      }

      if (!body.projects || !Array.isArray(body.projects)) {
        return c.json({ error: "projects is required" }, 400);
      }

      if (body.channels.length === 0 || body.projects.length === 0) {
        return c.json({ matches: [] });
      }

      const result = await withProcessingLog(
        "match-channels",
        MATCH_CHANNELS_MODEL,
        () => matchChannelsWithClaude(body.channels, body.projects),
        (res) => ({
          inputSize: body.channels.length,
          metadata: {
            channelCount: body.channels.length,
            projectCount: body.projects.length,
            matchCount: res.matches.length,
          },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/match-slack-channels] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

async function matchChannelsWithClaude(
  channels: RpcMatchSlackChannelsRequest["channels"],
  projects: RpcMatchSlackChannelsRequest["projects"],
): Promise<RpcMatchSlackChannelsResponse> {
  const channelList = channels.map((ch) => `- ${ch.channelName} (ID: ${ch.channelId})`).join("\n");

  const projectList = projects
    .map((p) => {
      const parts = [`ID: ${p.id}`, `名前: ${p.name}`];
      if (p.githubRepo) {
        parts.push(`GitHub: ${p.githubOwner}/${p.githubRepo}`);
      }
      return `- ${parts.join(", ")}`;
    })
    .join("\n");

  const prompt = `Slack チャンネルとプロジェクトのマッチングを行ってください。

## Slack チャンネル一覧
${channelList}

## プロジェクト一覧
${projectList}

## ルール
1. チャンネル名とプロジェクト名/GitHub リポジトリ名の類似性を判断
2. 明確に関連があるペアのみマッチング (曖昧な場合はスキップ)
3. general, random など汎用チャンネルはマッチングしない
4. 1つのチャンネルに対して最も適切な1つのプロジェクトのみ

## 出力形式
JSON のみ (マークダウンなし):
{
  "matches": [
    {
      "channelId": "チャンネルID",
      "channelName": "チャンネル名",
      "projectId": プロジェクトID (数値),
      "projectName": "プロジェクト名",
      "confidence": 0.0-1.0の信頼度,
      "reason": "マッチング理由 (短く)"
    }
  ]
}

マッチするペアがない場合は空配列を返してください。`;

  consola.info(
    `[worker/match-slack-channels] Matching ${channels.length} channels with ${projects.length} projects`,
  );

  const result = await runClaude(prompt, {
    model: MATCH_CHANNELS_MODEL,
    disableTools: true,
  });

  if (!result) {
    throw new Error("No response from channel matcher");
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    consola.warn(`[worker/match-slack-channels] Failed to parse response: ${result}`);
    return { matches: [] };
  }

  const parsed = JSON.parse(jsonMatch[0]) as { matches: ChannelProjectMatch[] };

  // Validate matches
  const validMatches = (parsed.matches || []).filter((match) => {
    // Ensure all required fields exist
    if (!match.channelId || !match.projectId) {
      return false;
    }
    // Ensure channel exists in input
    const channelExists = channels.some((ch) => ch.channelId === match.channelId);
    // Ensure project exists in input
    const projectExists = projects.some((p) => p.id === match.projectId);
    return channelExists && projectExists;
  });

  consola.info(`[worker/match-slack-channels] Found ${validMatches.length} valid matches`);

  return { matches: validMatches };
}
