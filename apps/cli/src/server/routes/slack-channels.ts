/**
 * Slack Channels API Routes
 *
 * チャンネル単位でのプロジェクト紐づけを管理
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { ProjectInfo, SlackChannelInfo } from "@repo/types";
import consola from "consola";
import { desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { matchSlackChannels } from "../../slack/channel-matcher.js";

export function createSlackChannelsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/slack-channels
   *
   * チャンネル一覧を取得
   */
  router.get("/", (c) => {
    const channels = db
      .select()
      .from(schema.slackChannels)
      .orderBy(desc(schema.slackChannels.updatedAt))
      .all();

    return c.json(channels);
  });

  /**
   * GET /api/slack-channels/:channelId
   *
   * 特定チャンネルを取得
   */
  router.get("/:channelId", (c) => {
    const channelId = c.req.param("channelId");

    const channel = db
      .select()
      .from(schema.slackChannels)
      .where(eq(schema.slackChannels.channelId, channelId))
      .get();

    if (!channel) {
      return c.json({ error: "Channel not found" }, 404);
    }

    return c.json(channel);
  });

  /**
   * PUT /api/slack-channels/:channelId
   *
   * チャンネルの projectId を更新
   * Body: { projectId?: number | null }
   */
  router.put("/:channelId", async (c) => {
    const channelId = c.req.param("channelId");
    const body = await c.req.json<{ projectId?: number | null }>();

    // チャンネルが存在するか確認
    const existing = db
      .select()
      .from(schema.slackChannels)
      .where(eq(schema.slackChannels.channelId, channelId))
      .get();

    if (!existing) {
      return c.json({ error: "Channel not found" }, 404);
    }

    // projectId のみ更新
    const updateData: { projectId?: number | null; updatedAt: string } = {
      updatedAt: new Date().toISOString(),
    };

    if (body.projectId !== undefined) {
      updateData.projectId = body.projectId;
    }

    const result = db
      .update(schema.slackChannels)
      .set(updateData)
      .where(eq(schema.slackChannels.channelId, channelId))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/slack-channels/auto-match
   *
   * AI を使って Slack チャンネルとプロジェクトを自動マッチング
   * - projectId が未設定のチャンネルのみ対象
   * - マッチング結果を slackChannels テーブルに保存
   */
  router.post("/auto-match", async (c) => {
    const config = loadConfig();

    if (!config.slack?.enabled) {
      return c.json({ error: "Slack integration is disabled" }, 400);
    }

    // 1. projectId が未設定のチャンネルを取得
    const unmatchedChannels = db
      .select()
      .from(schema.slackChannels)
      .where(isNull(schema.slackChannels.projectId))
      .all();

    if (unmatchedChannels.length === 0) {
      return c.json({
        message: "No unmatched channels found",
        matched: 0,
        channels: [],
      });
    }

    // 2. アクティブなプロジェクトを取得
    const projects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.isActive, true))
      .all();

    if (projects.length === 0) {
      return c.json({
        message: "No active projects found",
        matched: 0,
        channels: [],
      });
    }

    // 3. マッチング用のデータを準備
    const channelInfos: SlackChannelInfo[] = unmatchedChannels.map((ch) => ({
      channelId: ch.channelId,
      channelName: ch.channelName ?? ch.channelId,
    }));

    const projectInfos: ProjectInfo[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      githubOwner: p.githubOwner,
      githubRepo: p.githubRepo,
    }));

    // 4. AI でマッチング
    consola.info(
      `[auto-match] Matching ${channelInfos.length} channels with ${projectInfos.length} projects`,
    );

    const matches = await matchSlackChannels(channelInfos, projectInfos);

    // 5. マッチング結果を DB に保存
    const now = new Date().toISOString();
    const updatedChannels: Array<{
      channelId: string;
      channelName: string | null;
      projectId: number;
      projectName: string;
      confidence: number;
      reason: string;
    }> = [];

    for (const match of matches) {
      // 信頼度が 0.6 以上のマッチングのみ適用
      if (match.confidence >= 0.6) {
        db.update(schema.slackChannels)
          .set({
            projectId: match.projectId,
            updatedAt: now,
          })
          .where(eq(schema.slackChannels.channelId, match.channelId))
          .run();

        updatedChannels.push({
          channelId: match.channelId,
          channelName: match.channelName,
          projectId: match.projectId,
          projectName: match.projectName,
          confidence: match.confidence,
          reason: match.reason,
        });

        consola.info(
          `[auto-match] Matched #${match.channelName} -> ${match.projectName} (confidence: ${match.confidence})`,
        );
      } else {
        consola.info(
          `[auto-match] Skipped #${match.channelName} -> ${match.projectName} (confidence: ${match.confidence} < 0.6)`,
        );
      }
    }

    return c.json({
      message: `Matched ${updatedChannels.length} channels`,
      matched: updatedChannels.length,
      channels: updatedChannels,
    });
  });

  /**
   * GET /api/slack-channels/unmatched
   *
   * projectId が未設定のチャンネル一覧を取得
   */
  router.get("/unmatched", (c) => {
    const channels = db
      .select()
      .from(schema.slackChannels)
      .where(isNull(schema.slackChannels.projectId))
      .orderBy(desc(schema.slackChannels.updatedAt))
      .all();

    return c.json(channels);
  });

  return router;
}
